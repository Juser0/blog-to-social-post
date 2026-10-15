# Next — Blog → Social Converter

Next.js 통합 구현. 부팅 시 `link=` 인자로 AI 연결을 고른다.

- 상세 문서: [`AGENTS.md`](./AGENTS.md)
- 루트 개요·측정 기준: [`../README.md`](../README.md)

```bash
pnpm install
pnpm dev link=genkit              # http://localhost:3000 (기본)
pnpm dev link=langchain --port 3100
```

## How to Use

1. 키 준비: [OpenRouter 키](https://openrouter.ai/keys)를 `.env.local`에 저장한다 (`OPENROUTER_API_KEY=sk-or-...`). `.env.example` 참조.
2. 연결 선택 후 기동: `pnpm dev link=genkit|langchain|mastra|tanstack` (생략 시 genkit).
3. 브라우저에서 http://localhost:3000 접속:
   - 블로그 URL 입력 → 글 목록 → 글 선택
   - 플랫폼 토글 (LinkedIn·X·Instagram·Reminder) → 변환
   - 결과 카드 확인 (연결명·측정치는 화면 하단, 원본 응답은 dev 표시)
4. API로 바로 호출해도 된다 (JVM 서버와 동일 계약):

```bash
curl -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "스케줄러 요약 테스트: 오늘 할 일을 3줄로 요약해줘"}'

curl -X POST http://localhost:3000/api/convert \
  -H 'Content-Type: application/json' \
  -d '{"blogUrl": "justuser.tistory.com", "platforms": ["remember"]}'
```
