# SpringAI 변형

Kotlin + Spring Boot + Spring AI 기반 Blog → Social 변환 구현.

- 상태: 구현됨 (동작 검증됨)
- 실행: `OPENROUTER_API_KEY=sk-or-... ./gradlew bootRun` → http://localhost:8080
- 상세 문서: [`AGENTS.md`](./AGENTS.md)
- 목표: `Next/` 구현과 동일한 입력(RSS 블로그 글) → 동일한 출력(LinkedIn, X, Instagram cardNews+caption, Reminder) 제공
- 비교 포인트: ChatClient 사용성, 구조화 출력(MapOutputConverter), 어드바이저 체인, 토큰/비용, RSS 연동 편의성
