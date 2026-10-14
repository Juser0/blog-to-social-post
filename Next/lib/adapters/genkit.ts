import { genkit, modelRef } from 'genkit';
import { openAICompatible } from '@genkit-ai/compat-oai';
import { normalizeUsage } from '../measure.ts';
import type { ChatAdapter, ChatCallOptions, ChatCallResult, StructuredCallResult } from './types.ts';

/**
 * GenKit 연결. OpenRouter(OpenAI 호환) 엔드포인트에 compat 플러그인으로 붙는다.
 * 모델 ID 자체에 슬래시가 있어 modelRef 이름은 `<플러그인>/<모델ID>` 형태다.
 */
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free';

const PLUGIN_NAME = 'openrouter';

// 부팅 시 1회 연결: 첫 호출 때 클라이언트를 만든다.
// 모듈 로드 때 만들지 않는 이유: 하네스처럼 .env.local을 뒤늦게 읽는 실행 방식에서
// import 시점에는 키가 없을 수 있다. 서버에서는 첫 요청 전에 env가 로드되므로 동일하게 동작한다.
let cachedAi: ReturnType<typeof genkit> | null = null;

function ai(): ReturnType<typeof genkit> {
  if (!cachedAi) {
    cachedAi = genkit({
      plugins: [
        openAICompatible({
          name: PLUGIN_NAME,
          apiKey: process.env.OPENROUTER_API_KEY,
          baseURL: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
          defaultHeaders: {
            // OpenRouter 대시보드의 앱 귀속용 헤더입니다. 없어도 동작합니다.
            'HTTP-Referer': 'https://github.com/Juser0/blog-to-social-post',
            'X-Title': 'Blog to Social (Next/genkit)',
          },
        }),
      ],
    });
  }
  return cachedAi;
}

const defaultModel = modelRef({ name: `${PLUGIN_NAME}/${DEFAULT_MODEL}` });

function refFor(modelId: string) {
  return modelId === DEFAULT_MODEL ? defaultModel : modelRef({ name: `${PLUGIN_NAME}/${modelId}` });
}

export const genkitAdapter: ChatAdapter = {
  name: 'genkit',
  model: DEFAULT_MODEL,

  async chat(prompt: string, opts: ChatCallOptions): Promise<ChatCallResult> {
    const response = await ai().generate({
      model: refFor(opts.modelId),
      prompt,
      config: { maxOutputTokens: opts.maxTokens },
    });
    return { text: response.text, usage: normalizeUsage(response.usage) };
  },

  async convertStructured(prompt: string, schema: any, modelId: string): Promise<StructuredCallResult> {
    const response = await ai().generate({
      model: refFor(modelId),
      prompt,
      output: { schema },
    });
    return { output: response.output, usage: normalizeUsage(response.usage) };
  },
};
