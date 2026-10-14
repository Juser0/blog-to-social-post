import { Agent } from '@mastra/core/agent';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { normalizeUsage } from '../measure.ts';
import type { ChatAdapter, ChatCallOptions, ChatCallResult, StructuredCallResult } from './types.ts';

/**
 * Mastra 연결. Agent에 OpenRouter 모델(AI SDK 프로바이더)을 물려 1회 호출한다.
 * 도구를 등록하지 않고 maxSteps: 1로 묶어 순수 생성만 재므로, 비교 조건(1회 호출)이 깨지지 않는다.
 */
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free';

const BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

// 부팅 시 1회 연결: 프로바이더와 에이전트를 모듈 로드 때 만든다 (네트워크 I/O 없음).
// apiKey는 표준 env(OPENROUTER_API_KEY)에서 읽는다.
const provider = createOpenRouter({ baseURL: BASE_URL });

function modelFor(modelId: string, maxTokens?: number) {
  // 모델 ID 유니언에 :free 모델이 없어 캐스트한다. 런타임은 문자열 그대로 전달된다.
  // maxTokens는 호출별 설정으로 넘긴다 (chat 벤치마크의 출력 상한).
  return maxTokens === undefined
    ? provider.chat(modelId as never)
    : provider.chat(modelId as never, { maxTokens });
}

const agent = new Agent({
  id: 'blog-to-social',
  name: 'Blog to Social',
  instructions: '블로그 글을 요청된 SNS 플랫폼 규격에 맞게 재구성한다. 원문에 없는 사실을 지어내지 않는다.',
  model: modelFor(DEFAULT_MODEL),
});

export const mastraAdapter: ChatAdapter = {
  name: 'mastra',
  model: DEFAULT_MODEL,

  async chat(prompt: string, opts: ChatCallOptions): Promise<ChatCallResult> {
    const response = await agent.generate(prompt, {
      model: modelFor(opts.modelId, opts.maxTokens),
      maxSteps: 1,
    });
    return { text: response.text, usage: normalizeUsage(response.totalUsage) };
  },

  async convertStructured(prompt: string, schema: any, modelId: string): Promise<StructuredCallResult> {
    // genkit의 output.schema와 동등한 구조화 1회 호출. 실패(strict)하면 throw → 호출자가 재시도한다.
    // schema는 lib/schema.ts의 zod 인스턴스다 (Mastra는 Standard Schema로 v3/v4를 모두 읽는다).
    const response = await agent.generate(prompt, {
      model: modelFor(modelId),
      maxSteps: 1,
      structuredOutput: { schema },
    });
    return { output: response.object, usage: normalizeUsage(response.totalUsage) };
  },
};
