# Next — Blog → Social Converter (link 전환형)

> 모노레포 위치: `Next/` (구 `GenKit/`, `git mv`로 이력 유지). 루트 개요는 `../AGENTS.md`.

> A Next.js application that lets users select an RSS blog article and convert it to SNS content (LinkedIn, X/Twitter, Instagram cardNews + caption, Reminder). Features paginated feed listing, category filtering, dark/light mode, and per-platform output selection.

> AI 연결부는 부팅 시 `link=` 인자로 고른다: `pnpm dev link=genkit` (기본값), `link=langchain|mastra|tanstack`.
> 프롬프트·스키마·UI·측정 인프라는 공유하고, `lib/adapters/` (ChatAdapter 계약)만 갈아낀다.

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Type-check
pnpm typecheck       # tsc --noEmit

# Build (Turbopack)
pnpm build

# Run development server (AI 연결을 link= 로 선택, 생략 시 genkit)
pnpm dev link=genkit              # http://localhost:3000
pnpm dev link=langchain --port 3100
link=langchain pnpm dev           # env 직접 주입도 가능
```

## AI 연결 선택 (link)

| link | 구현 | 방식 |
|---|---|---|
| `genkit` (기본) | `lib/adapters/genkit.ts` | `genkit` + `@genkit-ai/compat-oai` → OpenRouter. 구조화 출력 `ai.generate({output: {schema}})` |
| `langchain` | `lib/adapters/langchain.ts` | `ChatOpenAI`를 OpenRouter `baseURL`에 직접 연결. 구조화 출력 `withStructuredOutput(schema, {method: 'jsonSchema', includeRaw: true})` |
| `mastra` | `lib/adapters/mastra.ts` | Mastra `Agent` + `@openrouter/ai-sdk-provider`. 도구 없이 `maxSteps: 1`. 구조화 출력 `generate(…, {structuredOutput: {schema}})` → `object` + `totalUsage` |
| `tanstack` | `lib/adapters/tanstack.ts` | TanStack AI `chat()` + `@tanstack/ai-openrouter`. 구조화는 스트리밍 1회 호출에서 complete 이벤트 객체 + RUN_FINISHED usage 수집 |

- 계약: `lib/adapters/types.ts` `ChatAdapter` (`chat` 1회 호출, `convertStructured` 1회 호출 — 재시도는 `lib/blog-to-social.ts`가 담당).
- 선택은 부팅 시 1회 확정된다: `scripts/dev.mjs`가 `link=` 인자를 소비해 `LINK` env로 넘기고,
  `lib/link.ts`가 검증한다. 잘못된 값이면 import 시점에 throw → 부팅 실패로 바로 드러난다.
- 부팅 로그: `scripts/dev.mjs`가 `[dev] link=...`를 찍고, `lib/adapters/index.ts`가 로드될 때
  `[ai/boot] link=... model=... key=ok|MISSING`을 찍는다. 어댑터 싱글턴도 이때 1회 생성된다.
- 측정 로그는 link별로 분리된다: `measurements/<link>.jsonl`.
- 디버그 패널: 결과 화면의 "연결: genkit|langchain" 표시와 "원본 응답 보기"는
  `NEXT_PUBLIC_SHOW_DEBUG=true/false`가 우선, 생략 시 dev 표시·prod(`next build/start`) 숨김.

## Available Scripts

| Script | Description |
|---|---|
| `pnpm build` | Turbopack build (outputs to `.next/`) |
| `pnpm dlx tsc --noEmit` | TypeScript check only |
| `pnpm dev` | Start dev server at `http://localhost:3000` |
| `pnpm test` | Run tests (if any) |

## Project Structure

```
.
├── app/                # Next.js app router (pages & API routes)
│   ├── api/articles/route.ts    # Paginated RSS feed listing (10 per page)
│   ├── api/convert/route.ts     # Genkit flow: list → select → convert → results (+ measurement)
│   ├── api/chat/route.ts        # 비교용 얇은 어댑터: POST /chat → {output, usage, latencyMs}
│   ├── ConversionOverlay.tsx    # Processing overlay with step progress
│   ├── globals.css              # CSS variables, theming, card entrance animations
│   └── page.tsx                 # Full UI: pagination, category chips, platform toggles, scroll
├── lib/                  # Shared logic (no Next.js/app router coupling)
│   ├── link.ts         # 부팅 시 link 선택 (genkit|langchain|mastra|tanstack, 잘못된 값이면 throw)
│   ├── adapters/       # ChatAdapter 계약 + 구현 (부팅 시 1회 연결)
│   │   ├── types.ts    # ChatAdapter 인터페이스 (chat/convertStructured)
│   │   ├── index.ts    # 활성 어댑터 싱글턴 + MODEL + missingApiKeyReason()
│   │   ├── genkit.ts   # genkit + compat-oai 구현
│   │   ├── langchain.ts# ChatOpenAI 직접 연결 구현
│   │   ├── mastra.ts   # Mastra Agent + OpenRouter 프로바이더 구현
│   │   └── tanstack.ts # TanStack AI chat() + OpenRouter 어댑터 구현
│   ├── feed.ts         # RSS parsing, article extraction, category handling
│   ├── blog-to-social.ts  # convertBlogFlow (일반 async 함수) + 동적 플랫폼 스키마 + 측정
│   ├── measure.ts      # 측정 요소: usage 정규화, 비용 추정, p50/p95, JSONL 기록 (프레임워크 무의존)
│   ├── schema.ts       # Zod schemas (FeedArticle, ArticleInfo, ConvertResponse)
│   └── platforms.ts    # Platform constants — moved from schema to avoid grpc build break
├── measurements/       # JSONL 측정 로그 (git 무시, 로컬 분석용, link별 파일)
├── package.json        # Dependencies: genkit 1.42.0, @langchain/openai 1.6.2, next 16.4.0, react 19
├── scripts/            # dev.mjs(link 부팅 래퍼) + Validation / test scripts
└── AGENTS.md           # This file
```

## Benchmark 측정 요소 (비교분석용)

다른 프레임워크 어댑터(Koog/SpringAI/LangChain/...)와 같은 잣대로 비교하기 위한 기준 구현.

### 어댑터 스펙

```
POST /chat
Req: { "prompt": string, "model"?: string, "maxTokens"?: number }
Res: { "output": string,
       "usage": { "promptTokens": number, "completionTokens": number, "totalTokens": number },
       "latencyMs": number, "attempts": number,
       "model": string, "costUsd": number | null }
```

- 재시도 없이 1회만 호출한다. 하네스가 순수 연결 성능(지연시간 p50/p95, 토큰·비용)을 재야 해서다.
- `POST /convert` 응답에도 `measurement: {model, latencyMs, attempts, usage, costUsd}`를 포함한다.
  단, convert는 일시 오류(503/429) 재시도를 하므로 `latencyMs`는 재시도·백오프 포함 총소요다.
- 모든 측정은 `measurements/<link>.jsonl`에 best-effort로 1줄씩 기록된다 (실패해도 본 요청은 성공 처리).
- `POST /chat` 응답에 `link` 필드가 포함된다 (어느 어댑터로 응답했는지 식별용).

### 측정 정의 (`lib/measure.ts`, genkit 무의존)

| 요소 | 내용 |
|---|---|
| `normalizeUsage` | Genkit(`inputTokens`)·OpenAI(`prompt_tokens`)형 payload를 `TokenUsage`로 정규화. `total`이 없으면 합으로 폴백, 불명이면 0 |
| `estimateCostUsd` | `$ / 1M tokens` 단가표. `:free`·미등록 모델은 `null`(비용 불명). 기준 모델 확정 시 단가표만 채우면 됨 |
| `percentile` / `summarizeLatencies` | 하네스용 분포 요약 `{count, min, mean, p50, p95, max}` |
| `appendMeasurementJsonl` | JSONL 기록. 쓰기 실패는 무시 |

### 미결정 사항 (루트 비교 계획에서 정하면 반영)

- 기준 모델: 전 프레임워크가 붙을 수 있는 하나로 고정 + `temperature: 0`·seed 고정 시 단가표·어댑터에 반영.
- function calling 비교 여부: 포함 시 `/chat`에 도구 정의·호출 성공률 필드 추가 필요.
- TTFT(스트리밍): 논스트리밍 어댑터라 측정 불가. 필요 시 스트리밍 어댑터(`/chat/stream`) 추가.

### 실행

```bash
pnpm test:measure   # 측정 헬퍼 스모크 테스트 (키 불필요)
curl -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "스케줄러 요약 테스트: 오늘 할 일을 3줄로 요약해줘"}'
pnpm measure:report          # LINK env에 맞는 measurements/<link>.jsonl 집계 → 요약 출력 + report.csv 저장
pnpm measure:report --kind=convert  # convert만 집계
LINK=langchain pnpm measure:report   # langchain 로그 집계
```

### 링크 비교 하네스 (CLI 전용, UI 미노출)

```bash
pnpm measure:benchmark                              # 4 link × 3라운드 (고정 프롬프트)
pnpm measure:benchmark --rounds=5 --links=mastra,tanstack
pnpm measure:benchmark --skip-convert               # chat만
```

- 고정 chat 프롬프트 3개 + 고정 convert 지문(remember)으로 각 link를 라운드로빈 측정한다.
  어댑터를 직접 호출하므로 서버 기동이 필요 없고, 결과는 웹에 노출되지 않는다.
- 결과는 `measurements/benchmark-<timestamp>.json` + 콘솔 요약표(p50/p95·토큰합·실패 내역).

### 실측 예 (2026-10-13, `:free` 모델)

- `/chat` 58자 프롬프트: `latencyMs=23266`, `usage={44, 994, 1038}`, `costUsd=0`, 클라이언트 체감 23.4s (서버 측정이므로 네트워크 제외 순수 연결+생성 시간)
- 주의: `maxTokens: 256`을 줘도 completion 994 토큰이 반환됨 — compat 플러그인/무료 모델이 상한을 무시할 수 있다. 하네스 설계 시 출력 길이 통제가 필요하면 프롬프트 지시로 보완.

## Key Decisions & Context

| Topic | Decision |
|---|---|
| **Model** | Switched from `gemini-2.5-flash` (404 for new users) to `gemini-3.8-flash` after API verification (4/4 success rate). |
| **OpenRouter** | Uses `nvidia/nemotron-3-ultra-550b-a55b:free` at `baseURL: https://openrouter.ai/api/v1`. |
| **API keys** | OpenRouter key required; Gemini key check added as guard. |
| **Platform selection** | UI checkboxes/chips control which SNS platforms get generated. Only selected platforms are sent to the model, saving tokens/cost. Default: all 4 selected. |
| **Dynamic schemas** | `buildSocialOutputSchema(platforms)` generates a Zod schema with only the requested platform fields. `PartialSocialOutputSchema` makes all fields optional in the API response. |
| **Category filtering** | Extracted from RSS `<category>` tags — last path segment only (e.g., "기록/회고" → "회고"). |
| **Dark/light mode** | Toggled via button; persistence via `localStorage` + `data-theme` on `<html>`. |
| **Build fix** | Moved `PLATFORM_IDS` constant from `lib/schema.ts` (which imports `genkit` → `grpc` → Node builtins like `async_hooks`/`fs`/`dns`) to `lib/platforms.ts` (no genkit dependency). Schema imports it as a **type only**. |
| **Conversion overlay** | Initially implemented then removed per user request; click blocking handled via `AbortController` + `body { overflow: hidden }`. |
| **Instagram as a unit** | `instagram` output contains both `cardNews` (5 items) and `caption` (with hashtags). They are always sent together; if Instagram is unselected, neither appears. |
| **Hash tag rule** | When Instagram is selected: "해시태그는 instagram.caption에만 넣음". When unselected: "어떤 항목에도 해시태그를 넣지 마세요." |
| **Build passes** | `tsc --noEmit` and `next build` both clean. No uncommitted changes. |

## Commands & Workflows

### Type Check
```bash
pnpm dlx tsc --noEmit
```

### Build
```bash
pnpm build          # Turbopack
# or
pnpm dlx next build
```

### Dev Server
```bash
pnpm dev link=genkit            # http://localhost:3000 (기본)
pnpm dev link=langchain --port 3100
```

### Git
```bash
git init              # (already initialized)
git add -A && git commit -m "Initial commit"
# typical workflow:
git status
git add <files>
git commit -m "description"
```

### Test Feed Validation (existing script)
```bash
pnpm dlx tsx scripts/test-feed.ts
```

## Code Conventions

- **File naming**: camelCase for TS/TSX, `kebab-case` for CSS utility classes.
- **Components**: `'use client'` at top when needed; type-only imports from `lib/` to avoid bundling server deps into client.
- **AI 연결**: `lib/adapters/`의 `ChatAdapter`를 통해서만 모델을 호출한다. 새 프레임워크 추가 시
  `ChatAdapter` 구현 1개 + `lib/link.ts`의 `LINK_NAMES`에 이름 등록이면 된다.
  `lib/blog-to-social.ts`의 `convertBlogFlow`는 일반 `async function`이다 (GenKit Flow 아님).
  input은 `blogUrl`, `articleUrl?`, `platforms?`; output schema는 요청 플랫폼에 따라 동적 생성.
- **RSS parsing**: `lib/feed.ts` — separates `listArticles` (paginated) from `fetchArticle` (single article) to avoid unnecessary scraping.
- **Theme**: `app/layout.tsx` initializes from `localStorage`, suppresses hydration warning.
- **CSS**: Uses CSS variables (`--bg`, `--panel`, `--text`, etc.) defined in `app/globals.css`. Light mode vars under `[data-theme='light']`.
- **Animations**: Card entrance uses `transition-timeline` + `var(--card-index)` for staggered fade-in. Reduced-motion media query honored.

## Adding New Platforms

1. Add platform id to `lib/platforms.ts` `PLATFORM_IDS` array.
2. Add schema fragment in `lib/schema.ts` `PLATFORM_FIELDS`.
3. Add prompt rule in `lib/blog-to-social.ts` `PLATFORM_RULES`.
4. Add UI button in `app/page.tsx` `PLATFORMS` array.
5. Add rendering conditional in the result `div.cards` section of `page.tsx`.

## Removing a Platform

1. Remove from `lib/platforms.ts` `PLATFORM_IDS`.
2. Remove schema fragment in `lib/schema.ts`.
3. Remove prompt rule in `lib/blog-to-social.ts`.
4. Remove UI button in `app/page.tsx`.
5. Remove rendering conditional in result `div.cards`.

## Known Gotchas

- **Build break from schema import**: Importing runtime values (not types) from `lib/schema.ts` into client components pulls in `genkit` → `grpc` → Node builtins, causing Turbopack "Can't resolve 'async_hooks'/'fs'/'dns'" errors. Always import as `type` from `lib/platforms.ts` for values, or keep schema imports as type-only.
- **langchain structured output**: `link=langchain`의 `convertStructured`는 `lib/schema.ts`의 zod 인스턴스(genkit이 re-export한 zod v3)를
  `withStructuredOutput`에 그대로 넘긴다. `raw`는 `BaseMessage` 타입이라 `usage_metadata`에 구조적 캐스트가 필요했다.
  `:free` 모델은 LangChain 경로에서 `usage_metadata`에 `total_tokens`만 내려 `promptTokens`/`completionTokens`이 0으로 기록된다
  (같은 모델도 genkit 경로에서는 3종 모두 내려옴). 비용 산정에 입·출력 분할이 필요하면 total 기준 안분 등 하네스 규칙이 필요하다.
- **mastra**: `mastra` 패키지는 CLI 전용이라 `Agent`는 `@mastra/core/agent`에서 가져온다 (직접 의존성으로 둠).
  모델 ID 유니언에 `:free` 모델이 없어 캐스트한다. usage는 `totalUsage`(input/output/totalTokens)를 쓴다.
- **tanstack**: `chat({outputSchema, stream: false})`는 객체만 돌려주고 usage를 잃으므로,
  구조화 호출은 스트리밍 1회로 complete 이벤트 객체 + RUN_FINISHED usage를 함께 수집한다.
  어댑터가 모델에 바인딩되므로 요청마다 `createOpenRouterText`로 만든다. URL 덮어쓰기는 `serverURL`로 한다.
  zod v3 스키마는 TanStack이 요구하는 `~standard.jsonSchema` 변환기가 없어서
  `zod-to-json-schema`로 일반 JSON 스키마로 바꿔 넘긴다 (동등한 response_format 1회 호출).
- **Google-genai unused**: `@genkit-ai/google-genai` is still in `package.json` deps but no longer imported. Uninstall if desired: `pnpm remove @genkit-ai/google-genai`.
- **Platform validation**: Convert button is disabled when `platforms.length === 0`. Selecting "전체 선택" re-checks all 4.
- **Instagram cardNews + caption**: Always a pair; cannot select one without the other.

## Last Verified

- `pnpm build` ✅ (Turbopack, all routes — `/api/chat` 포함, exit 0)
- `pnpm typecheck` ✅ (`tsc --noEmit`)
- `pnpm test:measure` ✅ (키 불필요)
- `pnpm dev link=genkit --port 3100` → `GET /` 200, `POST /api/chat` 200 (`link: genkit`), `measurements/genkit.jsonl` 기록 ✅
- `pnpm dev link=langchain --port 3101` → `GET /` 200, `POST /api/chat` 200 (`link: langchain`), `measurements/langchain.jsonl` 기록 ✅
- `pnpm dev link=mastra --port 3100` → `POST /api/chat` 200 (`link: mastra`, usage 3종 완전), `POST /api/convert` 200 (구조화·usage 완전) ✅
- `pnpm dev link=tanstack --port 3100` → `POST /api/chat` 200 (`link: tanstack`, usage 3종 완전), `POST /api/convert` 200 (구조화·usage 완전) ✅
- `pnpm dev link=bogus` → exit 2 + 사용법 에러 (서버 미기동) ✅
- Browser test (구 GenKit 시절): platform toggle, category filter, scroll-to-result, animation stagger, warning when no platform selected

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
