# GenKit — Blog → Social Converter

> 모노레포 위치: `GenKit/` (원 `devRelay-demo`). 루트 개요는 `../AGENTS.md`.

> A Next.js + Genkit application that lets users select an RSS blog article and convert it to SNS content (LinkedIn, X/Twitter, Instagram cardNews + caption, Reminder). Features paginated feed listing, category filtering, dark/light mode, and per-platform output selection.

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Type-check
pnpm dlx tsc --noEmit

# Build (Turbopack)
pnpm build          # or: pnpm dlx next build

# Run development server
pnpm dev            # or: pnpm dlx next dev  (defaults to http://localhost:3000)
```

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
│   ├── ai.ts           # Genkit config: gemini-3.8-flash + OpenRouter compatibility
│   ├── feed.ts         # RSS parsing, article extraction, category handling
│   ├── blog-to-social.ts  # Genkit flow with dynamic platform schemas (+ measurement)
│   ├── measure.ts      # 측정 요소: usage 정규화, 비용 추정, p50/p95, JSONL 기록 (genkit 무의존)
│   ├── schema.ts       # Zod schemas (FeedArticle, ArticleInfo, ConvertResponse)
│   └── platforms.ts    # Platform constants — moved from schema to avoid grpc build break
├── measurements/       # JSONL 측정 로그 (git 무시, 로컬 분석용)
├── package.json        # Dependencies: @genkit-ai/compat-oai 1.42.0, next 16.4.0, react 19
├── scripts/            # Validation / test scripts (test-measure.ts: 측정 헬퍼 스모크 테스트, measure-report.ts: JSONL 집계→요약+CSV)
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
- 모든 측정은 `measurements/genkit.jsonl`에 best-effort로 1줄씩 기록된다 (실패해도 본 요청은 성공 처리).

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
pnpm measure:report          # measurements/genkit.jsonl 집계 → 요약 출력 + report.csv 저장
pnpm measure:report --kind=convert  # convert만 집계
```

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
pnpm dev            # http://localhost:3000
# or
pnpm dlx next dev -p 3000
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
- **Genkit flows**: Declared in `lib/blog-to-social.ts`; input includes `blogUrl`, `articleUrl?`, `platforms?`; output schema is dynamically built per request.
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
- **Google-genai unused**: `@genkit-ai/google-genai` is still in `package.json` deps but no longer imported. Uninstall if desired: `pnpm remove @genkit-ai/google-genai`.
- **Platform validation**: Convert button is disabled when `platforms.length === 0`. Selecting "전체 선택" re-checks all 4.
- **Instagram cardNews + caption**: Always a pair; cannot select one without the other.

## Last Verified

- `pnpm build` ✅ (Turbopack, all routes — `/api/chat` 포함)
- `pnpm dlx tsc --noEmit` ✅
- `pnpm test:measure` ✅ (16 checks, 키 불필요)
- Browser test: platform toggle, category filter, scroll-to-result, animation stagger, warning when no platform selected