# Koog 변형

Kotlin + Ktor + JetBrains Koog 기반 Blog → Social 변환 구현.

- 상태: 구현됨 (동작 검증됨)
- 실행: `OPENROUTER_API_KEY=sk-or-... ./gradlew run` → http://localhost:8081
- 상세 문서: [`AGENTS.md`](./AGENTS.md)
- 목표: `Next/` 구현과 동일한 입력(RSS 블로그 글) → 동일한 출력(LinkedIn, X, Instagram cardNews+caption, Reminder) 제공
- 비교 포인트: PromptExecutor 사용성, 구조화 출력(수동/네이티브), 토큰/비용, RSS 연동 편의성

## How to Use

1. 키 준비: `OPENROUTER_API_KEY` env로 전달 (`.env` 파일은 읽지 않으므로 직접 주입).
2. 기동: `OPENROUTER_API_KEY=sk-or-... ./gradlew run` → http://localhost:8081 (바꾸려면 `PORT=3102`).
3. 브라우저에서 http://localhost:8081 접속 → 수동 테스트 페이지에서 블로그 URL·플랫폼 입력 후 변환.
4. API로 바로 호출해도 된다 (SpringAI·Next와 동일 계약):

```bash
curl -X POST http://localhost:8081/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "스케줄러 요약 테스트: 오늘 할 일을 3줄로 요약해줘"}'

curl -X POST http://localhost:8081/api/convert \
  -H 'Content-Type: application/json' \
  -d '{"blogUrl": "justuser.tistory.com", "platforms": ["remember"]}'
```
