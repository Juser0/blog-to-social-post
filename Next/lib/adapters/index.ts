import { LINK } from '../link.ts';
import { genkitAdapter } from './genkit.ts';
import { langchainAdapter } from './langchain.ts';
import { mastraAdapter } from './mastra.ts';
import { tanstackAdapter } from './tanstack.ts';
import type { ChatAdapter } from './types.ts';

export type { ChatAdapter } from './types.ts';

/**
 * 부팅 시 1회 확정되는 활성 어댑터. `pnpm dev link=genkit|langchain|mastra|tanstack`으로 고른다.
 * 라우트·플로우는 이 싱글턴만 보고, 프레임워크별 코드는 adapters/ 안에 격리된다.
 */
export const adapter: ChatAdapter =
  LINK === 'langchain'
    ? langchainAdapter
    : LINK === 'mastra'
      ? mastraAdapter
      : LINK === 'tanstack'
        ? tanstackAdapter
        : genkitAdapter;

/** 활성 어댑터의 기본 모델 ID (OPENROUTER_MODEL 미지정 시). */
export const MODEL = adapter.model;

// 부팅 시 연결 확정 로그. 이 모듈은 라우트가 처음 뜨는 시점에 로드되므로
// 여기서 클라이언트 생성 + 상태를 찍으면 "부팅 시 연결"이 보장된다.
// (instrumentation.ts를 쓰지 않는 이유: 번들러가 genkit→express까지
// Edge용으로 묶으려다 깨진다. 라우트는 nodejs 런타임이라 문제없다.)
if (process.env.NEXT_RUNTIME !== 'edge') {
  console.log(
    `[ai/boot] link=${LINK} model=${MODEL} key=${process.env.OPENROUTER_API_KEY ? 'ok' : 'MISSING(.env.local 확인)'}`,
  );
}

/** 키가 없으면 사람이 읽을 수 있는 사유를, 있으면 null을 돌린다. 라우트가 500 본문에 쓴다. */
export function missingApiKeyReason(): string | null {
  if (process.env.OPENROUTER_API_KEY) return null;
  return 'OPENROUTER_API_KEY가 설정되지 않았습니다. .env.local에 키를 넣고 서버를 다시 시작하세요.';
}
