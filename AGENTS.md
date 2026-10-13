# blog-to-social-post — AI 연결 로직 비교 검증용 모노레포

블로그 글을 SNS 콘텐츠로 변환하는 동일한 기능을 AI 프레임워크별로 구현해 비교 검증한다.

## 구조

| 폴더 | 내용 | 상태 |
|---|---|---|
| `GenKit/` | Next.js + Genkit 구현 (원본) | 동작 검증됨 — 상세는 `GenKit/AGENTS.md` |
| `Koog/` | Kotlin + JetBrains Koog (JVM/Gradle, pnpm 대상 아님) | 미구현 |
| `SpringAI/` | Java + Spring AI (JVM/Maven 또는 Gradle, pnpm 대상 아님) | 미구현 |
| `LangChain/` | LangChain (Python 또는 LangChain.js — 런타임 미정) | 미구현 |
| `TanstackAI/` | TanStack 기반 (스택 정의 필요) | 미구현 |
| `MastralAI/` | Mistral AI vs Mastra — 대상 확정 필요 | 미구현 |

## 공통 규칙

- 각 폴더는 독립 실행 가능해야 한다 (의존성·실행법을 각 폴더 README에 기록).
- API 키 등 비밀은 커밋 금지 (`.env*.local`, `.env`는 루트 `.gitignore`로 무시됨).
- 비교 기준: 동일 입력(RSS 블로그 글) → 동일 출력(LinkedIn, X, Instagram cardNews+caption, Reminder),
  프롬프트 정의 편의성, 구조화 출력, 스트리밍, 토큰/비용, RSS 연동 편의성.

## GenKit 실행 (현재 유일한 동작 구현)

```bash
cd GenKit
pnpm install
pnpm typecheck
pnpm dev
```
