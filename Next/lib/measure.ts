import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 비교분석(벤치마크)용 측정 요소. 프레임워크별 어댑터(Koog/SpringAI/LangChain/...)가
 * 같은 형태로 측정값을 반환할 수 있도록 GenKit 기준 구현을 둔다.
 * genkit에 의존하지 않으므로 어디서든 가져다 쓸 수 있다.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatMeasurement {
  model: string;
  latencyMs: number;
  attempts: number;
  usage: TokenUsage;
  costUsd: number | null;
}

export interface ChatAdapterRequest {
  prompt: string;
  model?: string;
  maxTokens?: number;
}

const EMPTY_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function toNonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Genkit/OpenAI 호환/Koog 등 제각각인 usage payload를 TokenUsage로 정규화한다. */
export function normalizeUsage(raw: unknown): TokenUsage {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_USAGE };

  const record = raw as Record<string, unknown>;
  const prompt = toNonNegativeInt(
    record.promptTokens ?? record.inputTokens ?? record.inputTokensCount ?? record.prompt_tokens,
  );
  const completion = toNonNegativeInt(
    record.completionTokens ?? record.outputTokens ?? record.outputTokensCount ?? record.completion_tokens,
  );
  const total = toNonNegativeInt(record.totalTokens ?? record.totalTokensCount ?? record.total_tokens);

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total > 0 ? total : prompt + completion,
  };
}

/**
 * 모델별 USD 단가표 ($/1M tokens). 기준 모델이 정해지면 하네스가 같은 표를 공유한다.
 * `:free` 모델과 미등록 모델은 null(비용 불명)로 둔다.
 */
const PRICE_PER_1M_USD: Record<string, { input: number; output: number }> = {
  'nvidia/nemotron-3-ultra-550b-a55b:free': { input: 0, output: 0 },
};

export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const price = PRICE_PER_1M_USD[model];
  if (!price) return null;

  return (usage.promptTokens * price.input + usage.completionTokens * price.output) / 1_000_000;
}

/** 오름차순 정렬된 표본의 p 분위수 (p: 0~100). */
export function percentile(sortedSamples: readonly number[], p: number): number {
  if (sortedSamples.length === 0) return 0;
  if (p <= 0) return sortedSamples[0]!;
  if (p >= 100) return sortedSamples[sortedSamples.length - 1]!;

  const rank = (p / 100) * (sortedSamples.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const low = sortedSamples[lower]!;

  return lower === upper ? low : low + (sortedSamples[upper]! - low) * (rank - lower);
}

export interface LatencySummary {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

/** 하네스가 같은 프롬프트 N회 측정 후 지연시간 분포를 요약할 때 쓴다. */
export function summarizeLatencies(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) return { count: 0, min: 0, mean: 0, p50: 0, p95: 0, max: 0 };

  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);

  return {
    count: sorted.length,
    min: sorted[0]!,
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1]!,
  };
}

/**
 * 측정 1건을 JSONL로 best-effort 기록한다. 파일 I/O 실패는 호출자까지
 * 실패시키지 않는다(서버리스 등 쓰기 불가 환경 대비).
 * fileName은 활성 link별 분리용 (예: `genkit.jsonl`, `langchain.jsonl`).
 */
export function appendMeasurementJsonl(entry: unknown, fileName = 'genkit.jsonl', dir?: string): void {
  try {
    const targetDir = dir ?? join(process.cwd(), 'measurements');
    mkdirSync(targetDir, { recursive: true });
    appendFileSync(join(targetDir, fileName), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // 측정 기록 실패가 본 요청까지 실패시키지 않는다.
  }
}
