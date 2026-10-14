package com.example.blogtosocial

import com.example.blogtosocial.model.ArticleInfo
import com.example.blogtosocial.model.ArticlesResponse
import com.example.blogtosocial.model.ChatResponse
import com.example.blogtosocial.model.ConvertResponse
import com.example.blogtosocial.model.ErrorResponse
import com.example.blogtosocial.model.LINK_NAME
import com.example.blogtosocial.model.Measurement
import com.example.blogtosocial.model.PlatformId
import com.example.blogtosocial.service.FeedService
import com.example.blogtosocial.service.MeasureService
import com.example.blogtosocial.service.PromptService
import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.jackson.jackson
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.http.content.staticResources
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import java.time.Instant

/**
 * Koog 앱 진입점. Next의 articles·convert·chat API와 같은 계약이다.
 * POST /api/articles · /api/convert · /api/chat (+ 수동 테스트용 / 페이지)
 */
fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8081
    val apiKey = System.getenv("OPENROUTER_API_KEY") ?: ""
    val baseUrl = System.getenv("OPENROUTER_BASE_URL") ?: "https://openrouter.ai/api/v1"
    val defaultModel = System.getenv("OPENROUTER_MODEL")
        ?: "nvidia/nemotron-3-ultra-550b-a55b:free"

    if (apiKey.isBlank()) {
        println("[koog/boot] link=koog model=$defaultModel key=MISSING(OPENROUTER_API_KEY 확인)")
    } else {
        println("[koog/boot] link=koog model=$defaultModel key=ok")
    }

    val promptService = PromptService()
    val feedService = FeedService()
    val measureService = MeasureService()
    val koogService = KoogService(apiKey, baseUrl, defaultModel, promptService, feedService, measureService)

    embeddedServer(Netty, port = port) {
        module(koogService, measureService, defaultModel)
    }.start(wait = true)
}

fun Application.module(koogService: KoogService, measureService: MeasureService, defaultModel: String) {
    install(ContentNegotiation) {
        jackson {
            registerKotlinModule()
            configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
            setSerializationInclusion(JsonInclude.Include.NON_NULL)
        }
    }
    install(StatusPages) {
        exception<Throwable> { call, cause ->
            call.respond(HttpStatusCode.InternalServerError, ErrorResponse(cause.message ?: "알 수 없는 오류"))
        }
    }

    routing {
        staticResources("/", "static")

        post("/api/articles") {
            val body = call.receive<JsonNode>()
            val blogUrl = body.get("blogUrl")?.asText()?.trim() ?: ""
            if (blogUrl.isEmpty()) {
                call.respond(HttpStatusCode.BadRequest, ErrorResponse("blogUrl이 필요합니다."))
                return@post
            }
            val page = (body.get("page")?.asInt() ?: 1).coerceAtLeast(1)

            try {
                val listing = koogService.articles(blogUrl)
                val pageCount = maxOf(1, (listing.articles.size + FeedService.PAGE_SIZE - 1) / FeedService.PAGE_SIZE)
                val currentPage = minOf(page, pageCount)
                val start = (currentPage - 1) * FeedService.PAGE_SIZE
                call.respond(
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
                call.respond(HttpStatusCode.InternalServerError, ErrorResponse(e.message ?: "알 수 없는 오류"))
            }
        }

        post("/api/convert") {
            val apiKey = System.getenv("OPENROUTER_API_KEY") ?: ""
            if (apiKey.isBlank()) {
                call.respond(
                    HttpStatusCode.InternalServerError,
                    ErrorResponse("OPENROUTER_API_KEY가 설정되지 않았습니다. 환경 변수에 키를 넣고 서버를 다시 시작하세요."),
                )
                return@post
            }
            val body = call.receive<JsonNode>()
            val blogUrl = body.get("blogUrl")?.asText()?.trim() ?: ""
            if (blogUrl.isEmpty()) {
                call.respond(HttpStatusCode.BadRequest, ErrorResponse("blogUrl이 필요합니다."))
                return@post
            }
            val articleUrl = body.get("articleUrl")?.asText()
            val platforms = body.get("platforms")?.mapNotNull { it.asText() }

            try {
                val result = koogService.convertBlog(blogUrl, articleUrl, platforms)
                val cost = measureService.estimateCostUsd(result.measurementModel, result.usage)
                measureService.appendMeasurementJsonl(
                    mapOf(
                        "kind" to "convert",
                        "at" to Instant.now().toString(),
                        "blogUrl" to blogUrl,
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
                    "[convert:$LINK_NAME] social shape: " + mapOf(
                        "linkedin" to result.social.linkedin?.let { "string" },
                        "remember" to result.social.remember?.let { "string" },
                        "twitter" to result.social.twitter?.let { "string" },
                        "instagram" to result.social.instagram?.let { "object" },
                    ).filterValues { it != null },
                )
                call.respond(
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
                call.respond(HttpStatusCode.InternalServerError, ErrorResponse(e.message ?: "알 수 없는 오류"))
            }
        }

        post("/api/chat") {
            val apiKey = System.getenv("OPENROUTER_API_KEY") ?: ""
            if (apiKey.isBlank()) {
                call.respond(
                    HttpStatusCode.InternalServerError,
                    ErrorResponse("OPENROUTER_API_KEY가 설정되지 않았습니다."),
                )
                return@post
            }
            val body = call.receive<JsonNode>()
            val prompt = body.get("prompt")?.asText() ?: ""
            if (prompt.isBlank()) {
                call.respond(HttpStatusCode.BadRequest, ErrorResponse("prompt가 필요합니다."))
                return@post
            }
            val modelId = body.get("model")?.asText()?.takeIf { it.isNotBlank() } ?: defaultModel
            val maxTokens = (body.get("maxTokens")?.asInt() ?: 1024).coerceAtLeast(1)

            try {
                val startedAt = System.currentTimeMillis()
                val result = koogService.chat(prompt, modelId, maxTokens)
                val latencyMs = System.currentTimeMillis() - startedAt
                val cost = measureService.estimateCostUsd(modelId, result.usage)
                measureService.appendMeasurementJsonl(
                    mapOf(
                        "kind" to "chat",
                        "at" to Instant.now().toString(),
                        "promptChars" to prompt.length,
                        "outputChars" to result.output.length,
                        "model" to modelId,
                        "latencyMs" to latencyMs,
                        "attempts" to 1,
                        "usage" to result.usage,
                        "costUsd" to cost,
                    ),
                )
                call.respond(
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
                call.respond(HttpStatusCode.InternalServerError, ErrorResponse(e.message ?: "알 수 없는 오류"))
            }
        }
    }
}

/** ObjectMapper 직접 접근이 필요할 때. (현재 미사용, 확장용) */
@Suppress("unused")
fun sharedMapper(): ObjectMapper = ObjectMapper().registerKotlinModule()
