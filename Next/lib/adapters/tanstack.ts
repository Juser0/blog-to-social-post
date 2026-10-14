import { chat, type JSONSchema } from '@tanstack/ai';
import { createOpenRouterText } from '@tanstack/ai-openrouter';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { normalizeUsage } from '../measure.ts';
import type { ChatAdapter, ChatCallOptions, ChatCallResult, StructuredCallResult } from './types.ts';

/**
 * TanStack AI 연결. chat()에 OpenRouter 어댑터를 물려 1회 호출한다.
 * 어댑터가 모델에 바인딩되므로 요청마다 만든다 (연결 자체가 아니라 설정 객체라 비용 없음).
 */
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free';

const BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

function adapterFor(modelId: string) {
  // 모델 ID 유니언에 :free 모델이 없어 캐스트한다. 런타임은 문자열 그대로 전달된다.
  return createOpenRouterText(modelId as any, process.env.OPENROUTER_API_KEY ?? '', {
    serverURL: BASE_URL,
    // OpenRouter 대시보드의 앱 귀속용 값입니다. 없어도 동작합니다.
    httpReferer: 'https://github.com/Juser0/blog-to-social-post',
    appTitle: 'Blog to Social (Next/tanstack)',
  });
}

/** 실행 chunk들에서 RUN_FINISHED의 usage를 찾아 정규화한다. */
function usageFromChunks(chunks: readonly unknown[]): ReturnType<typeof normalizeUsage> {
  for (const chunk of chunks) {
    if (chunk && typeof chunk === 'object' && (chunk as { type?: unknown }).type === 'RUN_FINISHED') {
      return normalizeUsage((chunk as { usage?: unknown }).usage);
    }
  }
  return normalizeUsage(undefined);
}

export const tanstackAdapter: ChatAdapter = {
  name: 'tanstack',
  model: DEFAULT_MODEL,

  async chat(prompt: string, opts: ChatCallOptions): Promise<ChatCallResult> {
    const { text, chunks } = await chat({
      adapter: adapterFor(opts.modelId),
      messages: [{ role: 'user', content: prompt }],
      modelOptions: { maxCompletionTokens: opts.maxTokens },
      stream: false,
    });
    return { text, usage: usageFromChunks(chunks) };
  },

  async convertStructured(prompt: string, schema: any, modelId: string): Promise<StructuredCallResult> {
    // outputSchema + stream:false는 객체만 돌려주고 usage를 잃으므로,
    // 스트리밍 형태로 1회 호출해 complete 이벤트의 객체와 RUN_FINISHED의 usage를 함께 챙긴다.
    // NOTE: lib/schema.ts는 zod v3라 TanStack이 요구하는 `~standard.jsonSchema` 변환기가 없다.
    // 그래서 zod-to-json-schema로 일반 JSON 스키마로 바꿔 넘긴다 (동등한 response_format 1회 호출).
    const stream = await chat({
      adapter: adapterFor(modelId),
      messages: [{ role: 'user', content: prompt }],
      outputSchema: zodToJsonSchema(schema) as unknown as JSONSchema,
      stream: true,
    });

    let object: unknown;
    const chunks: unknown[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
      if (chunk && typeof chunk === 'object' && (chunk as { name?: unknown }).name === 'structured-output.complete') {
        object = (chunk as { value?: { object?: unknown } }).value?.object;
      }
    }
    return { output: object, usage: usageFromChunks(chunks) };
  },
};
