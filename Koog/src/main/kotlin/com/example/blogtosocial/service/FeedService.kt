package com.example.blogtosocial.service

import com.example.blogtosocial.model.FeedSummary
import com.rometools.rome.feed.synd.SyndEntry
import com.rometools.rome.io.SyndFeedInput
import com.rometools.rome.io.XmlReader

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * RSS/스크래핑. Next의 lib/feed.ts + lib/article.ts와 같은 규칙이다.
 * 본문 추출은 정규식 기반(Next와 동일한 순서·동일 문구)으로 맞춰 비교 조건을 유지한다.
 */

class FeedService {

    private val httpClient: HttpClient = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.ALWAYS)
        .connectTimeout(Duration.ofSeconds(20))
        .build()

    data class FeedArticle(
        val title: String,
        val link: String,
        val author: String,
        val pubDate: String,
        val content: String,
        val sourceFeed: String,
        val contentSource: String,
    )

    data class FeedListing(
        val feedUrl: String,
        val articles: List<FeedSummary>,
    )

    fun listArticles(blogUrl: String): FeedListing {
        val (feedUrl, entries) = resolveFeed(blogUrl)
        val articles = entries.mapNotNull { toSummary(it) }
            .filter { it.title.isNotEmpty() || it.link.isNotEmpty() }
        return FeedListing(feedUrl, articles)
    }

    fun fetchArticle(blogUrl: String, articleUrl: String?): FeedArticle {
        val (feedUrl, entries) = resolveFeed(blogUrl)

        val entry = if (!articleUrl.isNullOrBlank()) {
            val wanted = normalizeArticleUrl(articleUrl)
            entries.find { normalizeArticleUrl(it.link ?: "") == wanted }
                ?: throw IllegalArgumentException("피드 목록에서 해당 글을 찾지 못했습니다. 목록을 다시 불러와 주세요.")
        } else {
            entries.firstOrNull() ?: throw IllegalStateException("피드에 글이 없습니다.")
        }

        val raw = entry.contents.firstOrNull()?.value
            ?: entry.description?.value
            ?: ""
        val feedContent = htmlToText(raw)
        val link = entry.link ?: ""
        val (content, source) = resolveFullContent(link, feedContent)

        return FeedArticle(
            title = entry.title ?: "",
            link = link.ifEmpty { feedUrl },
            author = entry.author ?: "",
            pubDate = entry.publishedDate?.toInstant()?.toString()
                ?: entry.updatedDate?.toInstant()?.toString() ?: "",
            content = content,
            sourceFeed = feedUrl,
            contentSource = source,
        )
    }

    // ---------- 피드 탐색 ----------

    private fun resolveFeed(blogUrl: String): Pair<String, List<SyndEntry>> {
        val base = normalizeBaseUrl(blogUrl)
        val errors = mutableListOf<String>()
        val startedAt = System.currentTimeMillis()

        for (path in CANDIDATE_FEEDS) {
            val remaining = FEED_SEARCH_BUDGET_MS - (System.currentTimeMillis() - startedAt)
            if (remaining <= 0) {
                errors.add("탐색 시간 초과로 나머지 경로는 시도하지 않음")
                break
            }
            val feedUrl = "$base$path"
            try {
                val xml = fetchFeedXml(feedUrl, minOf(FEED_TIMEOUT_MS, remaining))
                val feed = SyndFeedInput().build(XmlReader(xml.byteInputStream()))
                val items = feed.entries ?: emptyList()
                if (items.isEmpty()) {
                    errors.add("$feedUrl: 아이템 없음")
                    continue
                }
                return Pair(feedUrl, items)
            } catch (e: Exception) {
                errors.add("$feedUrl: ${e.message}")
            }
        }

        throw IllegalStateException("RSS 피드를 찾을 수 없습니다. tried -> ${errors.joinToString(" | ")}")
    }

    private fun fetchFeedXml(feedUrl: String, timeoutMs: Long): String {
        val request = HttpRequest.newBuilder(URI.create(feedUrl))
            .timeout(Duration.ofMillis(timeoutMs))
            .header(
                "Accept",
                "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8",
            )
            .header("User-Agent", USER_AGENT)
            .GET()
            .build()

        val response = try {
            httpClient.send(request, HttpResponse.BodyHandlers.ofString())
        } catch (e: Exception) {
            throw IllegalStateException("요청 실패 (${e.message})")
        }

        if (response.statusCode() !in 200..299) {
            throw IllegalStateException("상태 코드 ${response.statusCode()}")
        }

        val body = response.body()
        if (Regex("^\\s*(<!doctype html|<html)", RegexOption.IGNORE_CASE).containsMatchIn(body)) {
            if (Regex("just a moment|cf-browser-verification|challenge-platform", RegexOption.IGNORE_CASE)
                    .containsMatchIn(body)
            ) {
                throw IllegalStateException("Cloudflare 등 봇 방어벽에 막혔습니다")
            }
            throw IllegalStateException("HTML이 반환됨")
        }
        return body
    }

    private fun toSummary(entry: SyndEntry): FeedSummary? {
        return FeedSummary(
            title = (entry.title ?: "").trim(),
            link = entry.link ?: "",
            author = entry.author ?: "",
            pubDate = entry.publishedDate?.toInstant()?.toString()
                ?: entry.updatedDate?.toInstant()?.toString() ?: "",
            categories = toCategoryLabels(
                entry.categories?.mapNotNull { it.name } ?: emptyList(),
            ),
        )
    }

    private fun toCategoryLabels(categories: List<String>): List<String> {
        return categories
            .map { it.substringAfterLast("/").trim() }
            .filter { it.isNotEmpty() }
            .distinct()
    }

    private fun resolveFullContent(link: String, feedContent: String): Pair<String, String> {
        if (feedContent.length >= MIN_FULL_CONTENT_CHARS) return Pair(feedContent, "feed")
        if (link.isEmpty()) return Pair(feedContent, "feed")
        val scraped = fetchArticleText(link)
        if (scraped.length > feedContent.length) return Pair(scraped, "page")
        return Pair(feedContent, "feed")
    }

    // ---------- 본문 추출 (Next의 article.ts와 같은 정규식) ----------

    fun htmlToText(html: String): String {
        return decodeEntities(
            removeNoise(html)
                .replace(Regex("<[^>]+>"), " ")
                .replace(Regex("\\s+"), " "),
        )
    }

    fun extractArticleText(html: String): String {
        val region = pickContentRegion(removeNoise(html))
        val text = decodeEntities(
            markBlockBoundaries(region)
                .replace(Regex("<[^>]+>"), " ")
                .replace(Regex("[ \t\\f\\u000B]+"), " ")
                .replace(Regex(" *\n *"), "\n")
                .replace(Regex("\n{3,}"), "\n\n"),
        ).trim()
        if (text.length >= 400) return text
        return htmlToText(html)
    }

    fun fetchArticleText(url: String): String {
        return try {
            val request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofMillis(FETCH_TIMEOUT_MS))
                .header("User-Agent", USER_AGENT)
                .header("Accept", "text/html,application/xhtml+xml")
                .GET()
                .build()
            val response = httpClient.send(request, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() !in 200..299) return ""
            extractArticleText(response.body())
        } catch (_: Exception) {
            ""
        }
    }

    private fun decodeEntities(input: String): String {
        return input
            .replace(Regex("&#x([0-9a-f]+);", RegexOption.IGNORE_CASE)) {
                codePointToString(it.groupValues[1].toIntOrNull(16) ?: -1)
            }
            .replace(Regex("&#(\\d+);")) { codePointToString(it.groupValues[1].toIntOrNull() ?: -1) }
            .replace("&nbsp;", " ", ignoreCase = true)
            .replace("&amp;", "&", ignoreCase = true)
            .replace("&lt;", "<", ignoreCase = true)
            .replace("&gt;", ">", ignoreCase = true)
            .replace("&quot;", "\"", ignoreCase = true)
            .replace("&apos;", "'", ignoreCase = true)
            .replace("&hellip;", "...", ignoreCase = true)
            .replace("&mdash;", "—", ignoreCase = true)
            .replace("&ndash;", "–", ignoreCase = true)
            .trim()
    }

    private fun codePointToString(code: Int): String {
        if (code < 0 || code > 0x10FFFF) return ""
        return try {
            String(Character.toChars(code))
        } catch (_: Exception) {
            ""
        }
    }

    private fun removeNoise(html: String): String {
        return html
            .replace(Regex("<!--[\\s\\S]*?-->"), " ")
            .replace(
                Regex("<(script|style|noscript|template|svg|iframe|form|nav|aside|footer|header)\\b[\\s\\S]*?</\\1>", RegexOption.IGNORE_CASE),
                " ",
            )
            .replace(
                Regex("<(script|style|noscript|template|svg|iframe|form|nav|aside|footer|header)\\b[^>]*>", RegexOption.IGNORE_CASE),
                " ",
            )
    }

    private fun markBlockBoundaries(html: String): String {
        return html.replace(
            Regex("</?(p|div|section|article|br|li|ul|ol|tr|td|h[1-6]|blockquote|pre|figure|figcaption|hr)\\b[^>]*>", RegexOption.IGNORE_CASE),
            "\n",
        )
    }

    private fun pickContentRegion(html: String): String {
        val candidates = listOf(
            Regex("<article\\b[^>]*>", RegexOption.IGNORE_CASE),
            Regex("<main\\b[^>]*>", RegexOption.IGNORE_CASE),
            Regex("<[a-z]+[^>]*itemprop\\s*=\\s*[\"']articleBody[\"'][^>]*>", RegexOption.IGNORE_CASE),
        )
        for (start in candidates) {
            val match = start.find(html) ?: continue
            val tagName = Regex("^<([a-z]+)").find(match.value)?.groupValues?.get(1) ?: continue
            val bodyStart = match.range.last + 1
            val endIdx = html.lowercase().lastIndexOf("</$tagName>")
            if (endIdx <= bodyStart) continue
            return html.substring(bodyStart, endIdx)
        }
        return html
    }

    private fun normalizeBaseUrl(input: String): String {
        val trimmed = input.trim()
        val withProtocol = if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) {
            trimmed
        } else {
            "https://$trimmed"
        }
        val uri = URI.create(withProtocol)
        val path = uri.path?.trimEnd('/') ?: ""
        return "${uri.scheme}://${uri.authority}$path"
    }

    private fun normalizeArticleUrl(input: String): String {
        if (input.isEmpty()) return ""
        return try {
            val withProtocol = if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(input)) {
                input
            } else {
                "https://$input"
            }
            val uri = URI.create(withProtocol)
            val path = uri.path.trimEnd('/')
                .replace(Regex("/(index|default)\\.[a-z]+$", RegexOption.IGNORE_CASE), "")
            "${uri.scheme}://${uri.authority}$path".lowercase()
        } catch (_: Exception) {
            input.trim().lowercase()
        }
    }

    companion object {
        const val USER_AGENT = "Mozilla/5.0 (compatible; BlogToSocial/1.0; +https://nextjs.org)"
        const val PAGE_SIZE = 10

        private val CANDIDATE_FEEDS = listOf(
            "/rss", "/feed", "/feed.xml", "/rss.xml",
            "/atom.xml", "/index.xml", "/rss.php", "/feed.php",
        )
        private const val FEED_TIMEOUT_MS = 20_000L
        private const val FEED_SEARCH_BUDGET_MS = 25_000L
        private const val MIN_FULL_CONTENT_CHARS = 800
        private const val FETCH_TIMEOUT_MS = 10_000L
    }
}
