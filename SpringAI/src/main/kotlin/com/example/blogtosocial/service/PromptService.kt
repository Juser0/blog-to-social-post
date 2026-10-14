package com.example.blogtosocial.service

import com.example.blogtosocial.model.PlatformId
import org.springframework.stereotype.Service

/**
 * 프롬프트 본문·플랫폼 규칙·글자수 상한. Next의 lib/blog-to-social.ts와 같은 문구다.
 * 같은 프롬프트·같은 스키마로 연동 방식 차이만 재기 위해 일부러 맞춘다.
 */
@Service
class PromptService {

    fun trimForPrompt(content: String): String {
        if (content.length <= MAX_PROMPT_CONTENT_CHARS) return content
        val clipped = content.substring(0, MAX_PROMPT_CONTENT_CHARS)
        val lastBreak = clipped.lastIndexOf('\n')
        val kept = if (lastBreak > MAX_PROMPT_CONTENT_CHARS * 0.8) clipped.substring(0, lastBreak) else clipped
        return "$kept\n\n(원문 중간에서 잘렸습니다.)"
    }

    fun buildPrompt(title: String, content: String, platforms: List<PlatformId>): String {
        val hashtagRule = if (platforms.contains(PlatformId.INSTAGRAM)) {
            "- 해시태그는 instagram.caption에만 넣습니다. 다른 항목에는 #을 절대 넣지 마세요."
        } else {
            "- 어떤 항목에도 해시태그를 넣지 마세요."
        }

        return """아래는 블로그 글입니다. 이 글의 핵심을 요청한 SNS 플랫폼의 톤과 규격에 맞게 재구성하세요.

## 원문
제목: $title

$content

## 작성 규칙 (모든 항목에 공통으로 적용)
- 원문에 없는 사실을 지어내지 마세요. 단정할 수 없으면 "~할 수 있습니다" 같은 완곡한 표현을 쓰세요.
- 마크다운 기호를 쓰지 말고 순수 텍스트만 출력하세요. 역따옴표나 별표로 코드나 항목을 강조하지 말고, 필요한 함수명이나 속성명은 그냥 적으세요. 목록이 필요하면 "- "로 시작하세요.
$hashtagRule

## 플랫폼별 규격
${platforms.joinToString("\n") { PLATFORM_RULES[it] ?: "" }}"""
    }

    /**
     * 고른 플랫폼에 해당하는 항목만 담은 JSON 스키마 지시문.
     * Spring AI의 MapOutputConverter.getFormat()에 넣어 구조화 1회 호출을 유도한다.
     */
    fun buildJsonSchemaInstruction(platforms: List<PlatformId>): String {
        val props = platforms.joinToString(",\n") { FIELD_SCHEMAS[it] ?: "" }
        val required = platforms.joinToString(", ") { "\"${it.id}\"" }
        return """Respond with a JSON object matching this schema (no markdown, raw JSON only):
{
  "type": "object",
  "properties": {
$props
  },
  "required": [$required],
  "additionalProperties": false
}"""
    }

    companion object {
        /** 아주 긴 글이 통째로 들어가면 지연시간과 비용만 커져 앞부분 위주로 잘라 보낸다. */
        const val MAX_PROMPT_CONTENT_CHARS = 40_000

        /** 이 길이보다 짧으면 근거가 부족해 SNS 콘텐츠를 뽑아낼 수 없다. */
        const val MIN_USABLE_CONTENT_CHARS = 300

        /** 모델 일시 오류(503/429 등)만 짧게 재시도한다. Next의 generateWithRetry와 같은 정규식이다. */
        val RETRYABLE = Regex("UNAVAILABLE|RESOURCE_EXHAUSTED|\\[503|\\[429|high demand|try again later", RegexOption.IGNORE_CASE)
        const val MAX_ATTEMPTS = 3
        const val RETRY_DELAY_MS = 1_500L

        private val PLATFORM_RULES: Map<PlatformId, String> = mapOf(
            PlatformId.LINKEDIN to "- linkedin: 1200자 이내. 첫 줄에 임팩트 있는 한 줄 후킹, 이후 줄바꿈을 넣어 읽기 쉽게 작성. 마지막에 해시태그를 덧붙이지 마세요.",
            PlatformId.REMEMBER to "- remember: 80자 이내 한 문장 요약.",
            PlatformId.TWITTER to "- twitter: 280자 이내. 하나의 강한 주장 + 근거.",
            PlatformId.INSTAGRAM to "- instagram.cardNews: 정확히 5개의 문자열. 각 문자열은 \"1. 제목 - 본문\" 형식이며, 5장을 이어 읽으면 하나의 서사가 되도록 구성.\n- instagram.caption: 인스타그램 본문 + 관련 해시태그 5~10개.",
        )

        private val FIELD_SCHEMAS: Map<PlatformId, String> = mapOf(
            PlatformId.LINKEDIN to "    \"linkedin\": { \"type\": \"string\", \"description\": \"LinkedIn 피드에 올릴 전문(1200자 이내)\" }",
            PlatformId.REMEMBER to "    \"remember\": { \"type\": \"string\", \"description\": \"리마인더(알림)용 짧은 한 줄 요약(80자 이내)\" }",
            PlatformId.TWITTER to "    \"twitter\": { \"type\": \"string\", \"description\": \"X(트위터)용 트윗 본문(280자 이내)\" }",
            PlatformId.INSTAGRAM to "    \"instagram\": { \"type\": \"object\", \"properties\": { \"cardNews\": { \"type\": \"array\", \"items\": { \"type\": \"string\" }, \"minItems\": 5, \"maxItems\": 5 }, \"caption\": { \"type\": \"string\" } }, \"required\": [\"cardNews\", \"caption\"] }",
        )
    }
}
