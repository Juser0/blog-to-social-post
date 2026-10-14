package com.example.blogtosocial.service

import com.example.blogtosocial.model.InstagramOutput
import com.example.blogtosocial.model.PlatformId
import com.example.blogtosocial.model.SocialOutput
import com.example.blogtosocial.model.TokenUsage
import org.springframework.ai.chat.client.ChatClient
import org.springframework.ai.converter.MapOutputConverter
import org.springframework.ai.openai.OpenAiChatOptions
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service

/**
 * AI 호출부. Next의 lib/blog-to-social.ts + ChatAdapter에 대응한다.
 * 구조화 출력은 MapOutputConverter에 고른 플랫폼의 JSON 스키마 지시를 넣어
 * 1회 호출로 유도한다 (프롬프트 지시 방식 — response_format 강제와는 다름, AGENTS.md에 기록).
 */
@Service
class SocialService(
    private val chatClient: ChatClient,
    private val promptService: PromptService,
    private val feedService: FeedService,
    private val measureService: MeasureService,
    @Value("\${openrouter.model:nvidia/nemotron-3-ultra-550b-a55b:free}") private val defaultModel: String,
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

    private inner class SocialOutputConverter(platforms: List<PlatformId>) : MapOutputConverter() {
        private val instruction = promptService.buildJsonSchemaInstruction(platforms)
        override fun getFormat(): String = instruction
    }

    private fun optionsFor(modelId: String, maxTokens: Int?): OpenAiChatOptions {
        val builder = OpenAiChatOptions.builder().model(modelId)
        if (maxTokens != null && maxTokens > 0) {
            builder.maxCompletionTokens(maxTokens)
        }
        return builder.build()
    }

    private fun toUsage(raw: Any?): TokenUsage {
        if (raw == null) return TokenUsage()
        return try {
            val cls = raw.javaClass
            val prompt = (cls.getMethod("getPromptTokens").invoke(raw) as? Number)?.toLong() ?: 0
            val completion = (cls.getMethod("getCompletionTokens").invoke(raw) as? Number)?.toLong() ?: 0
            val total = (cls.getMethod("getTotalTokens").invoke(raw) as? Number)?.toLong() ?: 0
            TokenUsage(prompt, completion, if (total > 0) total else prompt + completion)
        } catch (_: Exception) {
            TokenUsage()
        }
    }

    /**
     * 비교용 얇은 어댑터. 재시도 없이 1회만 호출한다.
     */
    fun chat(prompt: String, modelId: String, maxTokens: Int): ChatResult {
        val response = chatClient.prompt()
            .user(prompt)
            .options(optionsFor(modelId, maxTokens))
            .call()
        val output = response.content() ?: ""
        val usage = toUsage(response.chatResponse()?.metadata?.usage)
        return ChatResult(output, usage)
    }

    /**
     * 블로그 RSS 1편을 읽어 플랫폼용 콘텐츠로 변환한다. 일시 오류만 짧게 재시도한다.
     */
    fun convertBlog(blogUrl: String, articleUrl: String?, requested: List<String>?): ConvertResult {
        val platforms = PlatformId.normalize(requested)
        val article = feedService.fetchArticle(blogUrl, articleUrl)

        if (article.content.length < PromptService.MIN_USABLE_CONTENT_CHARS) {
            throw IllegalStateException(
                "글 본문을 거의 읽지 못했습니다 (${article.content.length}자). " +
                    "RSS가 요약만 제공하고 원문 페이지도 읽지 못한 것 같으니, 다른 블로그 URL을 시도해 보세요.",
            )
        }

        val prompt = promptService.buildPrompt(
            article.title,
            promptService.trimForPrompt(article.content),
            platforms,
        )
        val converter = SocialOutputConverter(platforms)

        val startedAt = System.currentTimeMillis()
        var lastError: Exception? = null
        var attempts = 0
        for (attempt in 1..PromptService.MAX_ATTEMPTS) {
            attempts = attempt
            try {
                val call = chatClient.prompt()
                    .user(prompt)
                    .options(optionsFor(defaultModel, null))
                    .call()
                val raw = call.entity(converter) ?: throw IllegalStateException("모델이 스키마에 맞는 출력을 반환하지 않았습니다.")
                val usage = toUsage(call.chatResponse()?.metadata?.usage)
                return ConvertResult(
                    title = article.title,
                    link = article.link,
                    contentSource = article.contentSource,
                    social = toSocial(raw),
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
                            "application.yml의 openrouter.model을 다른 모델로 바꿔 보세요.",
                    )
                }
                Thread.sleep(PromptService.RETRY_DELAY_MS * attempt)
            }
        }
        throw lastError ?: IllegalStateException("알 수 없는 오류")
    }

    @Suppress("UNCHECKED_CAST")
    private fun toSocial(raw: Map<String, Any?>): SocialOutput {
        val instagramRaw = raw["instagram"] as? Map<String, Any?>
        return SocialOutput(
            linkedin = raw["linkedin"] as? String,
            remember = raw["remember"] as? String,
            twitter = raw["twitter"] as? String,
            instagram = instagramRaw?.let {
                InstagramOutput(
                    cardNews = (it["cardNews"] as? List<*>)?.filterIsInstance<String>(),
                    caption = it["caption"] as? String,
                )
            },
        )
    }
}
