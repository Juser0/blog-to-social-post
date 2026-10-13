import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendMeasurementJsonl,
  estimateCostUsd,
  normalizeUsage,
  percentile,
  summarizeLatencies,
} from '../lib/measure.ts';

let failures = 0;

function check(condition: boolean, name: string, detail?: unknown) {
  if (condition) {
    console.log(`OK ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`);
  }
}

// 분위수: 보간·경계·빈 입력
check(percentile([], 50) === 0, 'percentile 빈 입력은 0');
check(percentile([10, 20, 30, 40], 0) === 10, 'percentile p0은 최소값');
check(percentile([10, 20, 30, 40], 100) === 40, 'percentile p100은 최대값');
check(percentile([10, 20, 30, 40], 50) === 25, 'percentile p50 보간');
check(percentile([100, 200, 300, 400, 500], 95) === 480, 'percentile p95 보간');

// 분포 요약
const summary = summarizeLatencies([100, 200, 300, 400, 500]);
check(summary.count === 5, 'summary count', summary);
check(summary.min === 100 && summary.max === 500, 'summary min/max', summary);
check(summary.mean === 300, 'summary mean', summary);
check(summary.p50 === 300 && summary.p95 === 480, 'summary p50/p95', summary);
check(summarizeLatencies([]).count === 0, 'summary 빈 입력');

// usage 정규화: Genkit형, OpenAI형, 없음
check(
  JSON.stringify(normalizeUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })) ===
    JSON.stringify({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
  'usage Genkit형',
);
check(
  JSON.stringify(normalizeUsage({ prompt_tokens: 7, completion_tokens: 3 })) ===
    JSON.stringify({ promptTokens: 7, completionTokens: 3, totalTokens: 10 }),
  'usage OpenAI형 + total 폴백',
);
const empty = normalizeUsage(undefined);
check(empty.totalTokens === 0 && empty.promptTokens === 0, 'usage 없음은 0', empty);

// 비용: free 모델 0, 미등록 모델 null
check(
  estimateCostUsd('nvidia/nemotron-3-ultra-550b-a55b:free', {
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
  }) === 0,
  'cost free 모델은 0',
);
check(
  estimateCostUsd('unknown-model', { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }) === null,
  'cost 미등록 모델은 null',
);

// JSONL 기록: 임시 디렉터리에 1줄 쓰이는지
const dir = mkdtempSync(join(tmpdir(), 'measure-'));
appendMeasurementJsonl({ kind: 'test', latencyMs: 1 }, dir);
const lines = readFileSync(join(dir, 'langchain.jsonl'), 'utf8').trim().split('\n');
check(lines.length === 1 && JSON.parse(lines[0]!).kind === 'test', 'jsonl 1줄 기록', lines);
rmSync(dir, { recursive: true, force: true });

if (failures > 0) {
  console.log(`FAIL ${failures}건`);
  process.exitCode = 1;
} else {
  console.log('측정 헬퍼 전체 통과');
}
