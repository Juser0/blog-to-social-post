package com.example.blogtosocial.model

import com.fasterxml.jackson.annotation.JsonInclude

/** 플랫폼 ID. Next의 PLATFORM_IDS와 같다. */
enum class PlatformId(val id: String) {
    LINKEDIN("linkedin"),
    REMEMBER("remember"),
    TWITTER("twitter"),
    INSTAGRAM("instagram");

    companion object {
        fun all(): List<PlatformId> = entries.toList()

        /** 요청 목록이 비었으면 전체. Next의 normalizePlatforms와 같다. */
        fun normalize(requested: List<String>?): List<PlatformId> {
            if (requested.isNullOrEmpty()) return all()
            val wanted = requested.map { it.trim().lowercase() }.toSet()
            return all().filter { wanted.contains(it.id) }.ifEmpty { all() }
        }
    }
}

data class TokenUsage(
    val promptTokens: Long = 0,
    val completionTokens: Long = 0,
    val totalTokens: Long = 0,
)

data class Measurement(
    val model: String,
    val latencyMs: Long,
    val attempts: Int,
    val usage: TokenUsage,
    val costUsd: Double? = null,
)

data class InstagramOutput(
    val cardNews: List<String>? = null,
    val caption: String? = null,
)

/** 모델이 내려보내는 값은 부분적일 수 있어 전부 nullable이다. null은 응답에서 생략한다. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class SocialOutput(
    val linkedin: String? = null,
    val remember: String? = null,
    val twitter: String? = null,
    val instagram: InstagramOutput? = null,
)

data class ArticleInfo(
    val title: String,
    val link: String,
    val contentSource: String,
)

data class FeedSummary(
    val title: String,
    val link: String,
    val author: String,
    val pubDate: String,
    val categories: List<String> = emptyList(),
)

data class ArticlesRequest(
    val blogUrl: String = "",
    val page: Int = 1,
)

data class ArticlesResponse(
    val feedUrl: String,
    val page: Int,
    val pageCount: Int,
    val total: Int,
    val pageSize: Int,
    val articles: List<FeedSummary>,
)

data class ConvertRequest(
    val blogUrl: String = "",
    val articleUrl: String? = null,
    val platforms: List<String>? = null,
)

data class ConvertResponse(
    val article: ArticleInfo,
    val social: SocialOutput,
    val platforms: List<String>,
    val measurement: Measurement,
    val link: String = LINK_NAME,
)

data class ChatRequest(
    val prompt: String = "",
    val model: String? = null,
    val maxTokens: Int? = null,
)

data class ChatResponse(
    val output: String,
    val usage: TokenUsage,
    val latencyMs: Long,
    val attempts: Int,
    val model: String,
    val costUsd: Double?,
    val link: String = LINK_NAME,
)

data class ErrorResponse(val error: String)

const val LINK_NAME = "springai"
