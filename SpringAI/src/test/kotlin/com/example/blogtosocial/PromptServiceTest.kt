package com.example.blogtosocial

import com.example.blogtosocial.model.PlatformId
import com.example.blogtosocial.service.PromptService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** 네트워크 없이 도는 순수 로직 테스트. Next의 측정 스모크와 같은 자리다. */
class PromptServiceTest {

    private val prompts = PromptService()

    @Test
    fun `platforms가 비면 전체를 만든다`() {
        assertEquals(PlatformId.all(), PlatformId.normalize(null))
        assertEquals(PlatformId.all(), PlatformId.normalize(emptyList()))
        assertEquals(listOf(PlatformId.REMEMBER), PlatformId.normalize(listOf("remember")))
    }

    @Test
    fun `짧은 본문은 그대로 둔다`() {
        val content = "a".repeat(100)
        assertEquals(content, prompts.trimForPrompt(content))
    }

    @Test
    fun `긴 본문은 40000자에서 자르고 표시를 남긴다`() {
        val content = "가".repeat(50_000)
        val trimmed = prompts.trimForPrompt(content)
        assertTrue(trimmed.endsWith("(원문 중간에서 잘렸습니다.)"))
        assertTrue(trimmed.length < content.length)
    }

    @Test
    fun `인스타그램을 고르면 해시태그 규칙이 caption으로 간다`() {
        val prompt = prompts.buildPrompt("제목", "본문", listOf(PlatformId.INSTAGRAM))
        assertTrue(prompt.contains("instagram.caption에만 넣습니다"))
        assertTrue(prompt.contains("정확히 5개의 문자열"))
    }

    @Test
    fun `인스타그램을 빼면 해시태그 금지 규칙이 들어간다`() {
        val prompt = prompts.buildPrompt("제목", "본문", listOf(PlatformId.REMEMBER))
        assertTrue(prompt.contains("어떤 항목에도 해시태그를 넣지 마세요"))
    }

    @Test
    fun `스키마 지시문에 고른 플랫폼만 required로 들어간다`() {
        val instruction = prompts.buildJsonSchemaInstruction(listOf(PlatformId.REMEMBER, PlatformId.TWITTER))
        assertTrue(instruction.contains("\"remember\""))
        assertTrue(instruction.contains("\"twitter\""))
        assertTrue(!instruction.contains("\"linkedin\""))
    }
}
