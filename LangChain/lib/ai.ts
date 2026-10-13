import { ChatOpenAI } from '@langchain/openai';

/**
 * GenKit의 lib/ai.ts 대응. Genkit 플러그인 대신 LangChain.js ChatOpenAI를
 * OpenRouter(OpenAI 호환) 엔드포인트에 직접 붙인다. 모델 ID·env 변수명은
 * GenKit과 동일하게 유지해 비교 조건을 맞춘다.
 */
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free';

const BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

export function createChatModel(modelId: string = DEFAULT_MODEL, maxTokens?: number): ChatOpenAI {
  return new ChatOpenAI({
    model: modelId,
    apiKey: process.env.OPENROUTER_API_KEY,
    maxTokens,
    configuration: {
      baseURL: BASE_URL,
      defaultHeaders: {
        // OpenRouter 대시보드의 앱 귀속용 헤더입니다. 없어도 동작합니다.
        'HTTP-Referer': 'https://github.com/Juser0/blog-to-social-post',
        'X-Title': 'Blog to Social (LangChain)',
      },
    },
  });
}
