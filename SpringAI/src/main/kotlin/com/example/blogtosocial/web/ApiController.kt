package com.example.blogtosocial.web

import com.example.blogtosocial.model.ArticlesRequest
import com.example.blogtosocial.model.ArticlesResponse
import com.example.blogtosocial.model.ArticleInfo
import com.example.blogtosocial.model.ChatRequest
import com.example.blogtosocial.model.ChatResponse
import com.example.blogtosocial.model.ConvertRequest
import com.example.blogtosocial.model.ConvertResponse
import com.example.blogtosocial.model.ErrorResponse
import com.example.blogtosocial.model.LINK_NAME
import com.example.blogtosocial.model.Measurement
import com.example.blogtosocial.model.PlatformId
import com.example.blogtosocial.service.FeedService
import com.example.blogtosocial.service.MeasureService
import com.example.blogtosocial.service.SocialService
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/**
 * Next의 articles·convert·chat API와 같은 계약이다.
 * POST /api/articles · /api/convert · /api/chat
 */
@RestController
@RequestMapping("/api")
class ApiController(
    private val feedService: FeedService,
    private val socialService: SocialService,
    private val measureService: MeasureService,
    @Value("\${openrouter.api-key:}") private val apiKey: String,
    @Value("\${openrouter.model:nvidia/nemotron-3-ultra-550b-a55b:free}") private val defaultModel: String,
) {

    private fun missingKey(): ResponseEntity<Any>? {
        if (apiKey.isBlank()) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                ErrorResponse("OPENROUTER_API_KEY가 설정되지 않았습니다. 환경 변수에 키를 넣고 서버를 다시 시작하세요."),
            )
        }
        return null
    }

    @PostMapping("/articles")
    fun articles(@RequestBody body: Map<String, Any?>): ResponseEntity<Any> {
        val blogUrl = body["blogUrl"] as? String
        if (blogUrl.isNullOrBlank()) {
            return ResponseEntity.badRequest().body(ErrorResponse("blogUrl이 필요합니다."))
        }
        val page = (body["page"] as? Number)?.toInt()?.coerceAtLeast(1) ?: 1

        return try {
            val listing = feedService.listArticles(blogUrl.trim())
            val pageCount = maxOf(1, (listing.articles.size + FeedService.PAGE_SIZE - 1) / FeedService.PAGE_SIZE)
            val currentPage = minOf(page, pageCount)
            val start = (currentPage - 1) * FeedService.PAGE_SIZE
            ResponseEntity.ok(
                ArticlesResponse(
                    feedUrl = listing.feedUrl,
                    page = currentPage,
                    pageCount = pageCount,
                    total = listing.articles.size,
                    pageSize = FeedService.PAGE_SIZE,
                    articles = listing.articles.drop(start).take(FeedService.PAGE_SIZE),
                ),
            )
        } catch (e: Exception) {
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ErrorResponse(e.message ?: "알 수 없는 오류"))
        }
    }

    @PostMapping("/convert")
    fun convert(@RequestBody body: ConvertRequest?): ResponseEntity<Any> {
        missingKey()?.let { return it }
        if (body == null || body.blogUrl.isBlank()) {
            return ResponseEntity.badRequest().body(ErrorResponse("blogUrl이 필요합니다."))
        }

        return try {
            val result = socialService.convertBlog(body.blogUrl.trim(), body.articleUrl, body.platforms)
            val cost = measureService.estimateCostUsd(result.measurementModel, result.usage)
            measureService.appendMeasurementJsonl(
                mapOf(
                    "kind" to "convert",
                    "at" to java.time.Instant.now().toString(),
                    "blogUrl" to body.blogUrl.trim(),
                    "platforms" to result.platforms.map { it.id },
                    "article" to mapOf("title" to result.title, "link" to result.link),
                    "model" to result.measurementModel,
                    "latencyMs" to result.latencyMs,
                    "attempts" to result.attempts,
                    "usage" to result.usage,
                    "costUsd" to cost,
                ),
            )
            // 디버그용: 모델이 실제로 뭘 내려보냈는지 형태만 1줄 남긴다.
            println(
                "[convert:$LINK_NAME] social shape: " +
                    result.social.let {
                        mapOf(
                            "linkedin" to it.linkedin?.let { "string" },
                            "remember" to it.remember?.let { "string" },
                            "twitter" to it.twitter?.let { "string" },
                            "instagram" to it.instagram?.let { "object" },
                        ).filterValues { v -> v != null }
                    },
            )
            ResponseEntity.ok(
                ConvertResponse(
                    article = ArticleInfo(result.title, result.link, result.contentSource),
                    social = result.social,
                    platforms = result.platforms.map { it.id },
                    measurement = Measurement(
                        model = result.measurementModel,
                        latencyMs = result.latencyMs,
                        attempts = result.attempts,
                        usage = result.usage,
                        costUsd = cost,
                    ),
                ),
            )
        } catch (e: Exception) {
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ErrorResponse(e.message ?: "알 수 없는 오류"))
        }
    }

    @PostMapping("/chat")
    fun chat(@RequestBody body: ChatRequest?): ResponseEntity<Any> {
        missingKey()?.let { return it }
        val prompt = body?.prompt ?: ""
        if (prompt.isBlank()) {
            return ResponseEntity.badRequest().body(ErrorResponse("prompt가 필요합니다."))
        }

        val modelId = body?.model?.takeIf { it.isNotBlank() } ?: defaultModel
        val maxTokens = (body?.maxTokens ?: 1024).coerceAtLeast(1)

        return try {
            val startedAt = System.currentTimeMillis()
            val result = socialService.chat(prompt, modelId, maxTokens)
            val latencyMs = System.currentTimeMillis() - startedAt
            val cost = measureService.estimateCostUsd(modelId, result.usage)
            measureService.appendMeasurementJsonl(
                mapOf(
                    "kind" to "chat",
                    "at" to java.time.Instant.now().toString(),
                    "promptChars" to prompt.length,
                    "outputChars" to result.output.length,
                    "model" to modelId,
                    "latencyMs" to latencyMs,
                    "attempts" to 1,
                    "usage" to result.usage,
                    "costUsd" to cost,
                ),
            )
            ResponseEntity.ok(
                ChatResponse(
                    output = result.output,
                    usage = result.usage,
                    latencyMs = latencyMs,
                    attempts = 1,
                    model = modelId,
                    costUsd = cost,
                ),
            )
        } catch (e: Exception) {
            ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ErrorResponse(e.message ?: "알 수 없는 오류"))
        }
    }
}
