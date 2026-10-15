# SpringAI 변형

Kotlin + Spring Boot + Spring AI 기반 Blog → Social 변환 구현.

- 상태: 구현됨 (동작 검증됨)
- 실행: `OPENROUTER_API_KEY=sk-or-... ./gradlew bootRun` → http://localhost:8080
- 상세 문서: [`AGENTS.md`](./AGENTS.md)
- 목표: `Next/` 구현과 동일한 입력(RSS 블로그 글) → 동일한 출력(LinkedIn, X, Instagram cardNews+caption, Reminder) 제공
- 비교 포인트: ChatClient 사용성, 구조화 출력(MapOutputConverter), 어드바이저 체인, 토큰/비용, RSS 연동 편의성

## How to Use

1. 키 준비: `OPENROUTER_API_KEY` env로 전달. Java 22 필요 (Gradle 툴체인 자동 사용).
2. 기동: `OPENROUTER_API_KEY=sk-or-... ./gradlew bootRun` → http://localhost:8080 (바꾸려면 `--server.port=3101`).
3. UI는 없고 API만 제공한다. Next 웹 UI에서 쓰거나 curl로 호출한다:

```bash
# 글 목록
curl -X POST http://localhost:8080/api/articles \
  -H 'Content-Type: application/json' \
  -d '{"blogUrl": "justuser.tistory.com", "page": 1}'

# 실물 글 변환 (platforms 생략 시 전체 플랫폼)
curl -X POST http://localhost:8080/api/convert \
  -H 'Content-Type: application/json' \
  -d '{"blogUrl": "justuser.tistory.com", "platforms": ["remember"]}'

# 가벼운 연결 확인
curl -X POST http://localhost:8080/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "스케줄러 요약 테스트: 오늘 할 일을 3줄로 요약해줘"}'
```
