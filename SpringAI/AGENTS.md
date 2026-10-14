# SpringAI — Blog → Social Converter (Kotlin)

> 모노레포 위치: `SpringAI/`. 루트 개요·측정 기준은 `../README.md`, UI·프롬프트 기준은 `../Next/` (동일 입력 → 동일 출력).

> Kotlin + Spring Boot + Spring AI 앱. RSS 목록·본문 추출·프롬프트·재시도 규칙은 Next와 동일하고,
> AI 연결부만 Spring AI (`ChatClient` + `MapOutputConverter`)로 구현했다.

## Quick Start

```bash
# Java 22 필요 (Gradle 툴체인)
./gradlew test          # 순수 로직 테스트 (키 불필요)
./gradlew build         # 빌드
OPENROUTER_API_KEY=sk-or-... ./gradlew bootRun   # http://localhost:8080
```

## API (Next와 같은 계약)

```
POST /api/articles {blogUrl, page?} → {feedUrl, page, pageCount, total, pageSize, articles}
POST /api/convert  {blogUrl, articleUrl?, platforms?} → {article, social, platforms, measurement, link}
POST /api/chat     {prompt, model?, maxTokens?} → {output, usage, latencyMs, attempts, model, costUsd, link}
```

- `link`는 항상 `"springai"`, 측정은 `measurements/springai.jsonl`에 1줄씩 기록된다.
- 포트: 8080 기본 (Next 3000/3100과 동시 실행 가능). 바꾸려면 `--server.port=3101`.

## Benchmark 측정

```bash
curl -X POST http://localhost:8080/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "스케줄러 요약 테스트: 오늘 할 일을 3줄로 요약해줘"}'
```

## Next와의 차이 (연결부만)

| 위치 | Next (genkit 기준) | SpringAI |
|---|---|---|
| 클라이언트 | `genkit` + compat 플러그인 | `ChatClient` + `OpenAiChatModel` (OpenRouter baseURL) |
| 구조화 출력 | `output.schema` (response_format 강제) | `MapOutputConverter` 서브클래스에 플랫폼별 JSON 스키마 지시 → 프롬프트 지시 방식 1회 호출 |
| 사용량 | `response.usage` | `ChatResponse.metadata.usage` (prompt/completion/total 3종) |
| 재시도 | 정규식·3회·백오프 | 동일 (정규식·3회·백오프, `Thread.sleep`) |
| RSS | rss-parser | Rome + `java.net.http.HttpClient` |
| 본문 추출 | 정규식(htmlToText) | 동일 정규식을 Kotlin으로 이식 (비교 조건 유지) |

## Known Gotchas

- Spring AI는 `baseUrl`에 `/v1/chat/completions`을 스스로 붙인다. Next와 같은
  `OPENROUTER_BASE_URL(…/api/v1)`을 쓰면 `/v1`이 중복돼 404가 나므로, `AiConfig`에서 한 겹 벗긴다.
- 1.1의 `ChatClient`는 호출 체인에 모델 호출 어드바이저가 반드시 있어야 한다.
  Boot 자동 구성이 넣어주지 않아 `ChatModelCallAdvisor`를 직접 등록했다.
- 쓰는 모델 외의 OpenAI系 auto-config(audio/embedding/image/…​)는 키를 요구하며 뜨므로
  `application.yml`에서 제외했다.
- `spring-ai-starter-model-openai` 하나만 둔다. 다른 스타터는 필요 없다.
