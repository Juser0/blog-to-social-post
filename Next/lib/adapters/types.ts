import type { TokenUsage } from '../measure.ts';
import type { LinkName } from '../link.ts';

export interface ChatCallOptions {
  modelId: string;
  maxTokens: number;
}

export interface ChatCallResult {
  text: string;
  usage: TokenUsage;
}

export interface StructuredCallResult {
  output: unknown;
  usage: TokenUsage;
}

/**
 * AI 연결 어댑터 계약. genkit·langchain 구현이 이 형태를 맞춘다.
 * schema는 어댑터 경계라 any다: lib/schema.ts가 만드는 zod 인스턴스를
 * 각 구현이 자기 방식(jsonSchema response_format / output.schema)으로 넘긴다.
 */
export interface ChatAdapter {
  readonly name: LinkName;
  /** OPENROUTER_MODEL 미지정 시 쓰는 기본 모델 ID. */
  readonly model: string;
  /** 비교용 얇은 어댑터: 재시도 없이 1회 호출, 순수 텍스트. */
  chat(prompt: string, opts: ChatCallOptions): Promise<ChatCallResult>;
  /** 구조화 출력: 재시도 없이 1회 호출. 재시도 루프는 호출자(blog-to-social)가 맡는다. */
  convertStructured(prompt: string, schema: any, modelId: string): Promise<StructuredCallResult>;
}
