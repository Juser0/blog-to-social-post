# Koog 변형

Kotlin + Ktor + JetBrains Koog 기반 Blog → Social 변환 구현.

- 상태: 구현됨 (동작 검증됨)
- 실행: `OPENROUTER_API_KEY=sk-or-... ./gradlew run` → http://localhost:8081
- 상세 문서: [`AGENTS.md`](./AGENTS.md)
- 목표: `Next/` 구현과 동일한 입력(RSS 블로그 글) → 동일한 출력(LinkedIn, X, Instagram cardNews+caption, Reminder) 제공
- 비교 포인트: PromptExecutor 사용성, 구조화 출력(수동/네이티브), 토큰/비용, RSS 연동 편의성
