# blog-to-social-post — AI 연결 로직 비교 검증용 모노레포

블로그 글을 SNS 콘텐츠로 변환하는 동일한 기능을 AI 프레임워크별로 구현해 비교 검증한다.

## 구조

| 폴더 | 내용 | 상태 |
|---|---|---|
| `Next/` | Next.js 통합 구현. 부팅 시 `link=genkit\|langchain\|mastra\|tanstack`으로 AI 연결 선택 (구 `GenKit/`, 이력 유지) | 동작 검증됨 — 상세는 `Next/AGENTS.md` |
| `Koog/` | Kotlin + JetBrains Koog (JVM/Gradle, pnpm 대상 아님) | 미구현 |
| `SpringAI/` | Java + Spring AI (JVM/Maven 또는 Gradle, pnpm 대상 아님) | 미구현 |

## 공통 규칙

- 각 폴더는 독립 실행 가능해야 한다 (의존성·실행법을 각 폴더 README에 기록).
- API 키 등 비밀은 커밋 금지 (`.env*.local`, `.env`는 루트 `.gitignore`로 무시됨).
- 비교 기준: 동일 입력(RSS 블로그 글) → 동일 출력(LinkedIn, X, Instagram cardNews+caption, Reminder),
  프롬프트 정의 편의성, 구조화 출력, 스트리밍, 토큰/비용, RSS 연동 편의성.
- 기준 어댑터: Next가 `POST /chat → {output, usage, latencyMs, attempts, model, costUsd, link}` 참조 구현 제공
  (스펙·측정 정의는 `Next/AGENTS.md`의 "Benchmark 측정 요소" 절). 타 프레임워크 어댑터도 동일 응답 형태를 맞춘다.
- 미결정: 기준 모델 고정(전부 접근 가능 + temperature 0·seed 고정), function calling 비교 여부. 정해지면 단가표·어댑터에 반영.

## 동작 구현 실행 (Next)

```bash
cd Next
pnpm install
pnpm typecheck
pnpm dev link=genkit                # 기본 (http://localhost:3000)
pnpm dev link=mastra --port 3100    # genkit|langchain|mastra|tanstack 중 선택
```
