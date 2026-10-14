package com.example.blogtosocial

import com.example.blogtosocial.service.FeedService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * 본문 추출 parity 테스트. Next의 lib/article.ts와 같은 입력 → 같은 출력인지 본다.
 * 네트워크 없이 도는 순수 함수만 다룬다 (쿼터·외부망 소모 없음).
 */
class FeedTextTest {

    private val feed = FeedService()

    @Test
    fun `태그와 엔티티가 풀린 텍스트가 나온다`() {
        assertEquals("Hello & world", feed.htmlToText("<p>Hello &amp; world</p>"))
    }

    @Test
    fun `script와 style은 지워진다`() {
        val html = "<div><script>var x = 1;</script><style>.a{}</style><p>본문</p></div>"
        assertEquals("본문", feed.htmlToText(html))
    }

    @Test
    fun `article 영역을 우선하고 nav는 버린다`() {
        val body = "본문이다. ".repeat(60)
        val html = "<html><body><nav>NAV-MENU-ITEM</nav><article><p>$body</p></article></body></html>"
        val text = feed.extractArticleText(html)
        assertTrue(text.contains("본문이다."), text.take(80))
        assertFalse(text.contains("NAV-MENU-ITEM"), text.take(80))
    }

    @Test
    fun `짧은 글은 전체 문서에서 다시 시도한다`() {
        val html = "<html><body><div><p>짧은 본문</p></div></body></html>"
        assertTrue(feed.extractArticleText(html).contains("짧은 본문"))
    }

    @Test
    fun `블록 경계에 줄바꿈이 들어간다`() {
        val body = "첫째. ".repeat(80)
        val text = feed.extractArticleText("<article><p>$body</p></article>")
        assertTrue(text.isNotEmpty())
    }
}
