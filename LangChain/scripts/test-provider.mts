/**
 * 공급자 배선 진단 스크립트.
 *
 * 실제로 모델을 호출해서 오류 종류만으로 배선 상태를 판별합니다.
 *   - 401/인증 오류 -> OpenRouter까지 요청은 도달했습니다. baseURL과 모델 ID는 정상입니다.
 *   - 404 no endpoints -> 모델 ID가 잘못되었거나 해당 엔드포인트가 없습니다.
 *   - 연결 오류 -> baseURL이 잘못되었습니다.
 *
 * 사용법: OPENROUTER_API_KEY=sk-or-... npm run test:provider
 */
import { convertBlogFlow } from '../lib/blog-to-social.ts';

try {
  const result = await convertBlogFlow({ blogUrl: 'https://daringfireball.net' });
  console.log('성공:', JSON.stringify(result).slice(0, 300));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log('에러 메시지:', message.slice(0, 500));

  if (/401|auth|credential/i.test(message)) {
    console.log('판별: OpenRouter까지 도달했습니다. baseURL과 모델 ID는 정상입니다.');
  } else if (/404|no endpoints/i.test(message)) {
    console.log('판별: 모델 ID 또는 엔드포인트가 잘못되었습니다.');
  } else if (/ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)) {
    console.log('판별: baseURL에 연결하지 못했습니다.');
  } else {
    console.log('판별: 위에 해당하지 않는 오류입니다.');
  }
}

process.exit(0);