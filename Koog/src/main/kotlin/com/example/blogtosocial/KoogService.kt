package com.example.blogtosocial

import ai.koog.prompt.executor.clients.openrouter.OpenRouterClientSettings
import ai.koog.prompt.executor.clients.openrouter.OpenRouterLLMClient
import ai.koog.prompt.executor.model.PromptExecutor
import ai.koog.prompt.executor.model.PromptExecutorBuilder
import ai.koog.prompt.executor.model.executeStructured
import ai.koog.prompt.llm.LLMCapability
import ai.koog.prompt.llm.LLMProvider
import ai.koog.prompt.llm.LLModel
import ai.koog.prompt.message.ResponseMetaInfo
import ai.koog.prompt.params.LLMParams
import com.example.blogtosocial.model.PlatformId
import com.example.blogtosocial.model.SocialOutput
import com.example.blogtosocial.model.TokenUsage
import com.example.blogtosocial.service.FeedService
import com.example.blogtosocial.service.MeasureService
import com.example.blogtosocial.service.PromptService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * AI 호출부. Next의 lib/blog-to-social.ts + ChatAdapter에 대응한다.
 * Koog PromptExecutor에 OpenRouter 클라이언트를 물려 1회 호출한다.
 * 구조화는 executeStructured(수동 모드: JSON 스키마를 프롬프트에 주입, SpringAI 방식과 동급) 1회 호출이다.
 */
class KoogService(
    apiKey: String,
    baseUrl: String,
    val defaultModel: String,
    private val promptService: PromptService,
    private val feedService: FeedService,
    private val measureService: MeasureService,
) {
    data class ConvertResult(
        val title: String,
        val link: String,
        val contentSource: String,
        val social: SocialOutput,
        val platforms: List<PlatformId>,
        val measurementModel: String,
        val latencyMs: Long,
        val attempts: Int,
        val usage: TokenUsage,
    )

    data class ChatResult(
        val output: String,
        val usage: TokenUsage,
    )

    // OpenRouterClientSettings는 baseUrl 뒤에 api/v1/chat/completions을 스스로 붙인다.
    // Next와 같은 OPENROUTER_BASE_URL(…/api/v1)을 쓰면 경로가 중복돼 404가 나므로 두 겹을 벗긴다.
    private val normalizedBaseUrl = baseUrl.trimEnd('/').removeSuffix("/api/v1").removeSuffix("/v1")

    private val executor: PromptExecutor = PromptExecutorBuilder()
        .addClient(OpenRouterLLMClient(apiKey, OpenRouterClientSettings(baseUrl = normalizedBaseUrl)))
        .build()

    private fun modelFor(modelId: String): LLModel {
        return LLModel(
            provider = LLMProvider.OpenRouter,
            id = modelId,
            capabilities = listOf(LLMCapability.Temperature, LLMCapability.Completion),
        )
    }

    private fun toUsage(meta: ResponseMetaInfo?): TokenUsage {
        if (meta == null) return TokenUsage()
        val prompt = (meta.inputTokensCount ?: 0).toLong()
        val completion = (meta.outputTokensCount ?: 0).toLong()
        val total = (meta.totalTokensCount ?: 0).toLong()
        return TokenUsage(prompt, completion, if (total > 0) total else prompt + completion)
    }

    private fun SocialOutput.filterTo(platforms: List<PlatformId>): SocialOutput {
        return SocialOutput(
            linkedin = if (platforms.contains(PlatformId.LINKEDIN)) linkedin else null,
            remember = if (platforms.contains(PlatformId.REMEMBER)) remember else null,
            twitter = if (platforms.contains(PlatformId.TWITTER)) twitter else null,
            instagram = if (platforms.contains(PlatformId.INSTAGRAM)) instagram else null,
        )
    }

    /**
     * 글 목록. 본문은 긁지 않으므로 응답이 빠르다.
     */
    suspend fun articles(blogUrl: String): FeedService.FeedListing {
        return withContext(Dispatchers.IO) {
            feedService.listArticles(blogUrl)
        }
    }

    /**
     * 비교용 얇은 어댑터. 재시도 없이 1회만 호출한다.
     */
    suspend fun chat(promptText: String, modelId: String, maxTokens: Int): ChatResult {
        val response = withContext(Dispatchers.IO) {
            executor.execute(
                prompt = ai.koog.prompt.dsl.prompt("chat", LLMParams(maxTokens = maxTokens)) {
                    user(promptText)
                },
                model = modelFor(modelId),
            )
        }
        val output = response.parts
            .filterIsInstance<ai.koog.prompt.message.MessagePart.Text>()
            .joinToString("") { it.text }
        return ChatResult(output, toUsage(response.metaInfo))
    }

    /**
     * 블로그 RSS 1편을 읽어 플랫폼용 콘텐츠로 변환한다. 일시 오류만 짧게 재시도한다.
     */
    suspend fun convertBlog(blogUrl: String, articleUrl: String?, requested: List<String>?): ConvertResult {
        val platforms = PlatformId.normalize(requested)
        val article = feedService.fetchArticle(blogUrl, articleUrl)

        if (article.content.length < PromptService.MIN_USABLE_CONTENT_CHARS) {
            throw IllegalStateException(
                "글 본문을 거의 읽지 못했습니다 (${article.content.length}자). " +
                    "RSS가 요약만 제공하고 원문 페이지도 읽지 못한 것 같으니, 다른 블로그 URL을 시도해 보세요.",
            )
        }

        val promptText = promptService.buildPrompt(
            article.title,
            promptService.trimForPrompt(article.content),
            platforms,
        )

        val startedAt = System.currentTimeMillis()
        var lastError: Exception? = null
        var attempts = 0
        for (attempt in 1..PromptService.MAX_ATTEMPTS) {
            attempts = attempt
            try {
                val result = withContext(Dispatchers.IO) {
                    executor.executeStructured(
                        prompt = ai.koog.prompt.dsl.prompt("convert") {
                            user(promptText)
                        },
                        model = modelFor(defaultModel),
                        serializer = SocialOutput.serializer(),
                    )
                }
                val output = result.getOrThrow().data
                // StructuredResponse는 원문 메시지(Message.Assistant)를 들고 있어 usage를 거기서 읽는다.
                val usage = toUsage(result.getOrThrow().message.metaInfo)
                return ConvertResult(
                    title = article.title,
                    link = article.link,
                    contentSource = article.contentSource,
                    // Koog 수동 모드는 전체 스키마를 보내 모델이 안 고른 플랫폼까지 채울 수 있다.
                    // 응답 계약(요청한 플랫폼만)과 맞추기 위해 여기서 거른다. usage는 전체 생성 기준 그대로다.
                    social = output.filterTo(platforms),
                    platforms = platforms,
                    measurementModel = defaultModel,
                    latencyMs = System.currentTimeMillis() - startedAt,
                    attempts = attempts,
                    usage = usage,
                )
            } catch (e: Exception) {
                lastError = e
                if (!PromptService.RETRYABLE.containsMatchIn(e.message ?: "")) throw e
                if (attempt == PromptService.MAX_ATTEMPTS) {
                    throw IllegalStateException(
                        "OpenRouter가 ${PromptService.MAX_ATTEMPTS}회 연속 트래픽 혼잡(503)을 반환했습니다. " +
                            ":free 티어는 혼잡할 때가 많으니 잠시 후 다시 시도하거나, " +
                            "OPENROUTER_MODEL을 다른 모델로 바꿔 보세요.",
                    )
                }
                kotlinx.coroutines.delay(PromptService.RETRY_DELAY_MS * attempt)
            }
        }
        throw lastError ?: IllegalStateException("알 수 없는 오류")
    }
}
