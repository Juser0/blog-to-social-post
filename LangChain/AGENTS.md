<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# LangChain — Blog → Social Converter (GenKit 대비 케이스)

> 모노레포 위치: `LangChain/`. 루트 개요·측정 기준은 `../README.md`, 기준 구현은 `../GenKit/`.

> Next.js + LangChain.js 앱. 기술스택(UI·RSS·측정 인프리)은 GenKit과 동일하고,
> AI 연결부만 Genkit → LangChain.js로 교체했다. 같은 프롬프트·같은 모델·같은 스키마로 연동 방식 차이만 잰다.

## GenKit과의 차이 (연결부만)

| 위치 | GenKit | LangChain |
|---|---|---|
| 클라이언트 | `genkit` + `@genkit-ai/compat-oai` 플러그인 | `ChatOpenAI` (`@langchain/openai`)를 OpenRouter `baseURL`에 직접 연결 |
| 모델 지정 | `modelRef({name: 'openrouter/<id>'})` | `new ChatOpenAI({model: '<id>', ...})` (`lib/ai.ts` `createChatModel`) |
| 구조화 출력 | `ai.generate({output: {schema}})` | `withStructuredOutput(schema, {method: 'jsonSchema', includeRaw: true})` (1회 호출, GenKit과 동등 조건) |
| 사용량 | `response.usage` | `raw.usage_metadata` → `normalizeUsage`로 동일 `TokenUsage`에 정규화 |
| 플로우 | `ai.defineFlow` | 동일 입출력 계약의 일반 `async function convertBlogFlow` (GenKit Flow 아님) |
| temperature | 미지정(기본값) | 미지정(기본값) — GenKit과 동일 조건 유지 |

## 동일하게 유지한 것

- 프롬프트 본문·플랫폼 규칙·글자수 상한(`PLATFORM_RULES`, 40_000자 trim), 재시도 정책(정규식·3회·백오프) — `lib/blog-to-social.ts`
- RSS/스크래핑 (`lib/feed.ts`, `lib/article.ts`), 플랫폼 상수·Zod 스키마 (`lib/platforms.ts`, `lib/schema.ts` — `zod` 직접 import로만 변경)
- UI 전체 (`app/page.tsx` 등), 측정 인프라 (`lib/measure.ts` — 로그 파일명만 `langchain.jsonl`)
- 어댑터 스펙: `POST /chat` ↔ `POST /convert` 요청·응답 형태 GenKit과 동일

## Quick Start

```bash
pnpm install
pnpm typecheck        # tsc --noEmit
pnpm test:measure     # 측정 헬퍼 스모크 테스트 (키 불필요)
pnpm build
pnpm dev              # http://localhost:3000 (GenKit과 동시 실행 시 --port 3100)
```

## Benchmark 측정

```bash
curl -X POST http://localhost:3100/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "스케줄러 요약 테스트: 오늘 할 일을 3줄로 요약해줘"}'
pnpm measure:report            # measurements/langchain.jsonl 집계 → 요약 + report.csv
```

## Known Gotchas

- `withStructuredOutput`의 `raw`는 `BaseMessage` 타입이라 `usage_metadata`에 구조적 캐스트가 필요했다.
- `invoke` 2번째 인자로 `maxTokens`를 넘기면 규격 외라 무시될 수 있다 — 생성자에 주입한다.
- `method: 'jsonSchema'`는 GenKit의 `output.schema`와 동등한 `response_format` 1회 호출이다. 모델이 이를 지원하지 않으면 `functionCalling`으로 바꿔야 한다.
- 사용량 분해 차이(실측): `:free` 모델은 LangChain 경로에서 `usage_metadata`에 `total_tokens`만 내려
  `promptTokens`/`completionTokens`이 0으로 기록된다. 같은 모델도 GenKit 경로에서는 3종 모두 내려왔다.
  비용 산정에 입·출력 분할이 필요하면 total 기준 안분 등 하네스 규칙이 필요하다.
