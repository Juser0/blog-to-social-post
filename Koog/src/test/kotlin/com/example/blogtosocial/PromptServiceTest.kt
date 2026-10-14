package com.example.blogtosocial

import com.example.blogtosocial.model.PlatformId
import com.example.blogtosocial.service.PromptService
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 네트워크 없이 도는 순수 로직 테스트 (쿼터·외부망 소모 없음). */
class PromptServiceTest {

    private val prompts = PromptService()

    @Test
    fun platforms가_비면_전체를_만든다() {
        assertEquals(PlatformId.all(), PlatformId.normalize(null))
        assertEquals(PlatformId.all(), PlatformId.normalize(emptyList()))
        assertEquals(listOf(PlatformId.REMEMBER), PlatformId.normalize(listOf("remember")))
    }

    @Test
    fun 짧은_본문은_그대로_둔다() {
        val content = "a".repeat(100)
        assertEquals(content, prompts.trimForPrompt(content))
    }

    @Test
    fun 긴_본문은_40000자에서_자르고_표시를_남긴다() {
        val content = "가".repeat(50_000)
        val trimmed = prompts.trimForPrompt(content)
        assertTrue(trimmed.endsWith("(원문 중간에서 잘렸습니다.)"))
        assertTrue(trimmed.length < content.length)
    }

    @Test
    fun 인스타그램을_고르면_해시태그_규칙이_caption으로_간다() {
        val prompt = prompts.buildPrompt("제목", "본문", listOf(PlatformId.INSTAGRAM))
        assertTrue(prompt.contains("instagram.caption에만 넣습니다"))
        assertTrue(prompt.contains("정확히 5개의 문자열"))
    }

    @Test
    fun 인스타그램을_빼면_해시태그_금지_규칙이_들어간다() {
        val prompt = prompts.buildPrompt("제목", "본문", listOf(PlatformId.REMEMBER))
        assertTrue(prompt.contains("어떤 항목에도 해시태그를 넣지 마세요"))
    }
}
