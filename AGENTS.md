# devRelay-demo — Blog → Social Converter

> A Next.js + Genkit application that lets users select an RSS blog article and convert it to SNS content (LinkedIn, X/Twitter, Instagram cardNews + caption, Reminder). Features paginated feed listing, category filtering, dark/light mode, and per-platform output selection.

---

## Quick Start

```bash
# Install dependencies
npm install

# Type-check
npx tsc --noEmit

# Build (Turbopack)
npm run build          # or: npx next build

# Run development server
npm run dev            # or: npx next dev  (defaults to http://localhost:3000)
```

## Available Scripts

| Script | Description |
|---|---|
| `npm run build` | Turbopack build (outputs to `.next/`) |
| `npx tsc --noEmit` | TypeScript check only |
| `npm run dev` | Start dev server at `http://localhost:3000` |
| `npm test` | Run tests (if any) |

## Project Structure

```
.
├── app/                # Next.js app router (pages & API routes)
│   ├── api/articles/route.ts    # Paginated RSS feed listing (10 per page)
│   ├── api/convert/route.ts     # Genkit flow: list → select → convert → results
│   ├── ConversionOverlay.tsx    # Processing overlay with step progress
│   ├── globals.css              # CSS variables, theming, card entrance animations
│   └── page.tsx                 # Full UI: pagination, category chips, platform toggles, scroll
├── lib/                  # Shared logic (no Next.js/app router coupling)
│   ├── ai.ts           # Genkit config: gemini-3.8-flash + OpenRouter compatibility
│   ├── feed.ts         # RSS parsing, article extraction, category handling
│   ├── blog-to-social.ts  # Genkit flow with dynamic platform schemas
│   ├── schema.ts       # Zod schemas (FeedArticle, ArticleInfo, ConvertResponse)
│   └── platforms.ts    # Platform constants — moved from schema to avoid grpc build break
├── package.json        # Dependencies: @genkit-ai/compat-oai 1.42.0, next 16.4.0, react 19
├── scripts/            # Validation / test scripts
└── AGENTS.md           # This file
```

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
npx tsc --noEmit
```

### Build
```bash
npm run build          # Turbopack
# or
npx next build
```

### Dev Server
```bash
npm run dev            # http://localhost:3000
# or
npx next dev -p 3000
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
npx tsx scripts/test-feed.ts
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
- **Google-genai unused**: `@genkit-ai/google-genai` is still in `package.json` deps but no longer imported. Uninstall if desired: `npm uninstall @genkit-ai/google-genai`.
- **Platform validation**: Convert button is disabled when `platforms.length === 0`. Selecting "전체 선택" re-checks all 4.
- **Instagram cardNews + caption**: Always a pair; cannot select one without the other.

## Last Verified

- `npm run build` ✅ (Turbopack, all routes)
- `npx tsc --noEmit` ✅
- Browser test: platform toggle, category filter, scroll-to-result, animation stagger, warning when no platform selected