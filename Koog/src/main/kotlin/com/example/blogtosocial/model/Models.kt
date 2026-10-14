package com.example.blogtosocial.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

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

@Serializable
data class TokenUsage(
    val promptTokens: Long = 0,
    val completionTokens: Long = 0,
    val totalTokens: Long = 0,
)

@Serializable
data class Measurement(
    val model: String,
    val latencyMs: Long,
    val attempts: Int,
    val usage: TokenUsage,
    val costUsd: Double? = null,
)

/** Koog 구조화 출력용. @Serializable이 스키마 생성에 쓰인다. 모델이 빼먹을 수 있어 전부 nullable이다. */
@Serializable
@SerialName("InstagramOutput")
data class InstagramOutput(
    val cardNews: List<String>? = null,
    val caption: String? = null,
)

@Serializable
@SerialName("SocialOutput")
data class SocialOutput(
    val linkedin: String? = null,
    val remember: String? = null,
    val twitter: String? = null,
    val instagram: InstagramOutput? = null,
)

@Serializable
data class ArticleInfo(
    val title: String,
    val link: String,
    val contentSource: String,
)

@Serializable
data class FeedSummary(
    val title: String,
    val link: String,
    val author: String,
    val pubDate: String,
    val categories: List<String> = emptyList(),
)

@Serializable
data class ArticlesResponse(
    val feedUrl: String,
    val page: Int,
    val pageCount: Int,
    val total: Int,
    val pageSize: Int,
    val articles: List<FeedSummary>,
)

@Serializable
data class ConvertResponse(
    val article: ArticleInfo,
    val social: SocialOutput,
    val platforms: List<String>,
    val measurement: Measurement,
    val link: String = LINK_NAME,
)

@Serializable
data class ChatResponse(
    val output: String,
    val usage: TokenUsage,
    val latencyMs: Long,
    val attempts: Int,
    val model: String,
    val costUsd: Double?,
    val link: String = LINK_NAME,
)

@Serializable
data class ErrorResponse(val error: String)

const val LINK_NAME = "koog"
