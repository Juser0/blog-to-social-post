# Koog — Blog → Social Converter (Kotlin)

> 모노레포 위치: `Koog/`. 루트 개요·측정 기준은 `../README.md`, UI·프롬프트 기준은 `../Next/` (동일 입력 → 동일 출력).

> Kotlin + Ktor + JetBrains Koog 앱. RSS 목록·본문 추출·프롬프트·재시도 규칙은 Next와 동일하고,
> AI 연결부만 Koog (`PromptExecutor` + OpenRouter 클라이언트)로 구현했다.

## Quick Start

```bash
# Java 22 필요 (Gradle 툴체인)
./gradlew build           # 빌드
OPENROUTER_API_KEY=sk-or-... ./gradlew run   # http://localhost:8081 (+ 수동 테스트용 / 페이지)
```

## API (Next와 같은 계약)

```
POST /api/articles {blogUrl, page?} → {feedUrl, page, pageCount, total, pageSize, articles}
POST /api/convert  {blogUrl, articleUrl?, platforms?} → {article, social, platforms, measurement, link}
POST /api/chat     {prompt, model?, maxTokens?} → {output, usage, latencyMs, attempts, model, costUsd, link}
```

- `link`는 항상 `"koog"`, 측정은 `measurements/koog.jsonl`에 1줄씩 기록된다.
- 포트: 8081 기본 (SpringAI 8080·Next 3000/3100과 동시 실행 가능). 바꾸려면 `PORT=3102`.

## Benchmark 측정

```bash
curl -X POST http://localhost:8081/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "스케줄러 요약 테스트: 오늘 할 일을 3줄로 요약해줘"}'
```

## Next와의 차이 (연결부만)

| 위치 | Next (genkit 기준) | Koog |
|---|---|---|
| 클라이언트 | `genkit` + compat 플러그인 | `PromptExecutorBuilder().addClient(OpenRouterLLMClient)` |
| 구조화 출력 | `output.schema` (response_format 강제) | `executeStructured(prompt, model, serializer)` 수동 모드 (JSON 스키마 프롬프트 주입, 1회 호출) |
| 사용량 | `response.usage` | `StructuredResponse.message.metaInfo` (input/output/total 3종) |
| 재시도 | 정규식·3회·백오프 | 동일 (정규식·3회·백오프, `delay`) |
| RSS | rss-parser | Rome + `java.net.http.HttpClient` |
| 본문 추출 | 정규식(htmlToText) | 동일 정규식을 Kotlin으로 이식 (비교 조건 유지) |
| 웹 | Next.js | Ktor (Netty) + 테스트용 정적 페이지 1장 |

## Known Gotchas

- Koog 1.3.0은 Kotlin 2.3 메타데이터라 Kotlin 2.1 컴파일러가 거부한다.
  `-Xskip-metadata-version-check`로 완화했다 (JVM 바이트코드는 호환).
- `OpenRouterClientSettings`는 baseUrl 뒤에 `api/v1/chat/completions`을 붙인다.
  Next와 같은 `OPENROUTER_BASE_URL(…/api/v1)`을 쓰면 중복돼 404가 나므로 `/api/v1`을 벗긴다.
- 수동 모드는 `@Serializable` 클래스 전체 스키마를 보내서, 안 고른 플랫폼까지 모델이 채울 수 있다.
  응답 계약을 맞추기 위해 서버에서 요청 플랫폼만 남기고 거른다 (usage는 전체 생성 기준).
  모델이 규격을 어길 수 있음(실측: cardNews 6장·여러 줄 문자열) — 렌더 가드는 호출側(Next UI) 책임이다.
- `executeStructured`는 확장 함수라 import가 필요하다 (`ai.koog.prompt.executor.model.executeStructured`).
