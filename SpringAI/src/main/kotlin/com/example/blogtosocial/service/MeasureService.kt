package com.example.blogtosocial.service

import com.example.blogtosocial.model.TokenUsage
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Service
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardOpenOption

/**
 * 비교분석용 측정 요소. Next의 lib/measure.ts와 같은 정의다.
 * 어떤 AI 프레임워크에도 의존하지 않는다.
 */
@Service
class MeasureService(private val objectMapper: ObjectMapper) {

    /** 모델별 USD 단가표 ($/1M tokens). `:free`·미등록은 null(비용 불명). */
    private val pricePer1M: Map<String, Pair<Double, Double>> = mapOf(
        "nvidia/nemotron-3-ultra-550b-a55b:free" to Pair(0.0, 0.0),
    )

    fun estimateCostUsd(model: String, usage: TokenUsage): Double? {
        val price = pricePer1M[model] ?: return null
        return (usage.promptTokens * price.first + usage.completionTokens * price.second) / 1_000_000.0
    }

    /**
     * 측정 1건을 JSONL로 best-effort 기록한다. 파일 I/O 실패는 호출자까지
     * 실패시키지 않는다. 파일명은 활성 link별 분리 (예: springai.jsonl).
     */
    fun appendMeasurementJsonl(entry: Any, fileName: String = "springai.jsonl", dir: Path? = null) {
        try {
            val targetDir = dir ?: Paths.get(System.getProperty("user.dir"), "measurements")
            Files.createDirectories(targetDir)
            val line = objectMapper.writeValueAsString(entry) + "\n"
            Files.writeString(
                targetDir.resolve(fileName), line,
                Charsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND,
            )
        } catch (_: Exception) {
            // 측정 기록 실패가 본 요청까지 실패시키지 않는다.
        }
    }
}
