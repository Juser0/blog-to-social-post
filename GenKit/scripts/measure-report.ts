import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { summarizeLatencies } from '../lib/measure.ts';

/**
 * measurements/genkit.jsonl을 읽어 지연시간 분포(p50/p95)·토큰 합계를 출력하고
 * 같은 내용을 CSV로 저장한다. 공통 하네스가 생기기 전까지 GenKit 단독 측정을
 * 집계하는 용도. 사용법:
 *   node --experimental-strip-types scripts/measure-report.ts [jsonl경로] [--kind chat|convert]
 */

interface Row {
  at?: unknown;
  kind?: unknown;
  model?: unknown;
  latencyMs?: unknown;
  attempts?: unknown;
  promptChars?: unknown;
  outputChars?: unknown;
  usage?: { promptTokens?: unknown; completionTokens?: unknown; totalTokens?: unknown };
  costUsd?: unknown;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const kindFilter = process.argv
    .slice(2)
    .find((a) => a.startsWith('--kind='))
    ?.slice('--kind='.length);

  const jsonlPath = args[0] ?? join(process.cwd(), 'measurements', 'genkit.jsonl');
  if (!existsSync(jsonlPath)) {
    console.error(`측정 로그가 없습니다: ${jsonlPath}`);
    process.exitCode = 1;
    return;
  }

  const rows: Row[] = [];
  for (const line of readFileSync(jsonlPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Row;
      if (kindFilter && row.kind !== kindFilter) continue;
      rows.push(row);
    } catch {
      // 깨진 줄은 건너뛴다.
    }
  }

  if (rows.length === 0) {
    console.error('집계할 행이 없습니다.');
    process.exitCode = 1;
    return;
  }

  const latencies = rows.map((r) => num(r.latencyMs));
  const summary = summarizeLatencies(latencies);
  const promptSum = rows.reduce((acc, r) => acc + num(r.usage?.promptTokens), 0);
  const completionSum = rows.reduce((acc, r) => acc + num(r.usage?.completionTokens), 0);
  const costs = rows.map((r) => (typeof r.costUsd === 'number' ? r.costUsd : null));
  const costSum = costs.every((c) => c === null) ? null : costs.reduce((acc, c) => acc + (c ?? 0), 0);

  console.log(`행 수: ${summary.count} (kinds: ${[...new Set(rows.map((r) => String(r.kind)))].join(',')})`);
  console.log(
    `지연시간ms: min=${summary.min} mean=${Math.round(summary.mean)} p50=${summary.p50} p95=${summary.p95} max=${summary.max}`,
  );
  console.log(`토큰합: prompt=${promptSum} completion=${completionSum}`);
  console.log(`비용합USD: ${costSum === null ? '불명(단가표 미등록)' : costSum}`);

  const header = 'at,kind,model,latencyMs,attempts,promptTokens,completionTokens,totalTokens,costUsd';
  const csv = [
    header,
    ...rows.map((r) =>
      [
        String(r.at ?? ''),
        String(r.kind ?? ''),
        String(r.model ?? ''),
        num(r.latencyMs),
        num(r.attempts),
        num(r.usage?.promptTokens),
        num(r.usage?.completionTokens),
        num(r.usage?.totalTokens),
        typeof r.costUsd === 'number' ? r.costUsd : '',
      ].join(','),
    ),
  ].join('\n');

  const csvPath = join(dirname(jsonlPath), 'report.csv');
  mkdirSync(dirname(csvPath), { recursive: true });
  writeFileSync(csvPath, `${csv}\n`, 'utf8');
  console.log(`CSV 저장: ${csvPath}`);
}

main();
