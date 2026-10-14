import { ChatOpenAI } from '@langchain/openai';
import { normalizeUsage } from '../measure.ts';
import type { ChatAdapter, ChatCallOptions, ChatCallResult, StructuredCallResult } from './types.ts';

/**
 * LangChain.js 연결. ChatOpenAI를 OpenRouter(OpenAI 호환) baseURL에 직접 붙인다.
 * 모델 ID·env 변수명은 genkit 어댑터와 동일하게 유지해 비교 조건을 맞춘다.
 */
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free';

const BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

function createChatModel(modelId: string = DEFAULT_MODEL, maxTokens?: number): ChatOpenAI {
  return new ChatOpenAI({
    model: modelId,
    apiKey: process.env.OPENROUTER_API_KEY,
    maxTokens,
    configuration: {
      baseURL: BASE_URL,
      defaultHeaders: {
        // OpenRouter 대시보드의 앱 귀속용 헤더입니다. 없어도 동작합니다.
        'HTTP-Referer': 'https://github.com/Juser0/blog-to-social-post',
        'X-Title': 'Blog to Social (Next/langchain)',
      },
    },
  });
}

/** LangChain 메시지 content(문자열 또는 파트 배열)를 문자열로 바꾼다. */
function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
        return (part as { text: string }).text;
      }
      return '';
    })
    .join('');
}

export const langchainAdapter: ChatAdapter = {
  name: 'langchain',
  model: DEFAULT_MODEL,

  async chat(prompt: string, opts: ChatCallOptions): Promise<ChatCallResult> {
    const message = await createChatModel(opts.modelId, opts.maxTokens).invoke(prompt);
    return {
      text: messageContentToString(message.content),
      usage: normalizeUsage(message.usage_metadata),
    };
  },

  async convertStructured(prompt: string, schema: any, modelId: string): Promise<StructuredCallResult> {
    // genkit의 output.schema와 동등한 response_format(json_schema) 1회 호출 + 원문 포함으로 usage 확보.
    // withStructuredOutput의 raw는 BaseMessage 타입이라 usage_metadata에 구조적 캐스트가 필요하다.
    // schema는 lib/schema.ts의 zod 인스턴스다 (genkit이 re-export한 zod v3 — langchain도 v3 형태로 읽는다).
    const structured = createChatModel(modelId).withStructuredOutput(schema, {
      method: 'jsonSchema',
      includeRaw: true,
    });
    const { parsed, raw } = await structured.invoke(prompt);
    const rawMessage = raw as { usage_metadata?: unknown } | undefined;
    return { output: parsed, usage: normalizeUsage(rawMessage?.usage_metadata) };
  },
};
