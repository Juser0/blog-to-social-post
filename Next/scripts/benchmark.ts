/**
 * 링크별 연동 성능 측정 하네스. CLI 전용이다 (UI·라우트에 노출하지 않는다).
 *
 * 고정 프롬프트 세트를 각 link 어댑터에 라운드로빈으로 쏴서 시간대 편차를 상쇄하고,
 * chat(순수 텍스트 1회)과 convert(구조화 1회)의 latencyMs p50/p95·usage를 집계한다.
 *
 * 두 가지 전송 방식:
 * - 직접 호출(기본): Next 어댑터(genkit|langchain|mastra|tanstack)를 프로세스内で 호출.
 *   서버 기동 불필요, HTTP 계층 제외의 순수 연결+생성 측정.
 * - HTTP (--transport=http --base-url=... --link=springai|koog): JVM 서버의
 *   /api/chat·/api/convert를 같은 고정 프롬프트로 호출. 6종 동일 잣대 비교용.
 *   convert는 서버가 RSS 실물을 읽으므로(합성 지문 불가) 같은 글·같은 플랫폼으로 고정한다.
 *
 * 사용법 (Next/ 디렉터리):
 *   pnpm measure:benchmark                          # 4 link × 3라운드
 *   pnpm measure:benchmark --rounds=5 --links=mastra,tanstack
 *   pnpm measure:benchmark --skip-convert            # chat만
 *   pnpm measure:benchmark --model=openrouter/some-model
 *   pnpm measure:benchmark --transport=http --base-url=http://localhost:8080 --links=springai --rounds=3
 *
 * 키는 OPENROUTER_API_KEY env 또는 .env.local에서 읽는다 (직접 호출 모드).
 * 결과: measurements/benchmark-<timestamp>.json (원시 행) + 콘솔 요약표.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LINK_NAMES, type LinkName } from '../lib/link.ts';
import { genkitAdapter } from '../lib/adapters/genkit.ts';
import { langchainAdapter } from '../lib/adapters/langchain.ts';
import { mastraAdapter } from '../lib/adapters/mastra.ts';
import { tanstackAdapter } from '../lib/adapters/tanstack.ts';
import type { ChatAdapter } from '../lib/adapters/types.ts';
import { buildSocialOutputSchema } from '../lib/schema.ts';
import { summarizeLatencies, type TokenUsage } from '../lib/measure.ts';

/** 고정 chat 프롬프트. 짧고 결정적이라 반복 측정 편차가 적다. */
const CHAT_PROMPTS = [
  '한 줄로 답해: 1+1은?',
  '스케줄러 요약 테스트: 오늘 할 일을 3줄로 요약해줘',
  '한 줄로 답해: 서울의 수도는?',
];

/** 고정 convert 지문. RSS 변동 없이 구조화 경로만 잰다 (remember 1개 플랫폼). */
const CONVERT_TITLE = '아침 루틴 회고';
const CONVERT_CONTENT = [
  '지난 한 달간 아침 6시 기상을 시도했다.',
  '첫 2주는 실패했지만, 휴대폰을 거실에 두는 규칙을 만든 뒤로는 80% 성공했다.',
  '운동 20분과 독서 30분을 번갈아 했고, 컨디션 점수는 평균 7점에서 8점으로 올랐다.',
  '다음 달에는 주말에도 같은 기상 시간을 유지해볼 계획이다.',
].join(' ');
const CONVERT_PLATFORMS = ['remember'] as const;

const ADAPTERS: Record<LinkName, ChatAdapter> = {
  genkit: genkitAdapter,
  langchain: langchainAdapter,
  mastra: mastraAdapter,
  tanstack: tanstackAdapter,
};

interface Row {
  at: string;
  link: string;
  kind: 'chat' | 'convert';
  round: number;
  promptChars: number;
  ok: boolean;
  latencyMs: number;
  usage: TokenUsage;
  error?: string;
}

/** HTTP 모드(JVM 서버용)의 고정 convert 입력. 직접 모드의 합성 지문과 같은 remember 1개다. */
const HTTP_CONVERT_BLOG = 'justuser.tistory.com';
const HTTP_CONVERT_ARTICLE = 'https://justuser.tistory.com/44';
const HTTP_CONVERT_PLATFORMS = ['remember'];

/** .env.local을 최소 파싱으로 읽는다 (dotenv 없이). 이미 env에 있으면 건드리지 않는다. */
function loadLocalEnv(): void {
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const key = trimmed.slice(0, trimmed.indexOf('=')).trim();
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(trimmed.indexOf('=') + 1).trim();
    }
  }
}

function parseArgs(): {
  rounds: number;
  links: string[];
  skipConvert: boolean;
  model?: string;
  maxTokens: number;
  transport: 'direct' | 'http';
  baseUrl: string;
  delayMs: number;
} {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const found = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!found) return undefined;
    return found.includes('=') ? found.slice(found.indexOf('=') + 1) : 'true';
  };

  const rounds = Math.max(1, Number.parseInt(get('rounds') ?? '3', 10) || 3);
  const transport = get('transport') === 'http' ? 'http' : 'direct';
  const defaultLinks = transport === 'http' ? ['springai'] : [...LINK_NAMES];
  const links = (get('links') ?? defaultLinks.join(','))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (transport === 'direct') {
    const bad = links.filter((l) => !(LINK_NAMES as readonly string[]).includes(l));
    if (bad.length > 0 || links.length === 0) throw new Error(`links가 잘못됐습니다. ${LINK_NAMES.join('|')} 중 고르세요.`);
  } else if (links.length === 0) {
    throw new Error('http 모드는 --links=springai[,koog] 처럼 서버별 link 이름을 주세요.');
  }

  return {
    rounds,
    links,
    skipConvert: get('skip-convert') === 'true',
    model: get('model'),
    maxTokens: Math.max(1, Number.parseInt(get('max-tokens') ?? '256', 10) || 256),
    transport,
    baseUrl: (get('base-url') ?? 'http://localhost:8080').replace(/\/+$/, ''),
    delayMs: Math.max(0, Number.parseInt(get('delay-ms') ?? '2000', 10) || 0),
  };
}

function emptyUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function toUsage(raw: unknown): TokenUsage {
  if (!raw || typeof raw !== 'object') return emptyUsage();
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const prompt = num(r.promptTokens ?? r.inputTokens ?? r.prompt_tokens);
  const completion = num(r.completionTokens ?? r.outputTokens ?? r.completion_tokens);
  const total = num(r.totalTokens ?? r.total_tokens);
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total > 0 ? total : prompt + completion };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const { rounds, links, skipConvert, model, maxTokens, transport, baseUrl, delayMs } = parseArgs();
  if (transport === 'direct' && !process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY가 없습니다. env 또는 .env.local에 넣으세요.');
  }
  const modelId = model ?? ADAPTERS[links[0] as LinkName]?.model ?? 'nvidia/nemotron-3-ultra-550b-a55b:free';
  const convertSchema = buildSocialOutputSchema([...CONVERT_PLATFORMS]);
  const convertPrompt = `아래는 블로그 글이다. 핵심을 요청한 SNS 플랫폼 규격에 맞게 재구성하라.\n\n## 원문\n제목: ${CONVERT_TITLE}\n\n${CONVERT_CONTENT}\n\n## 플랫폼별 규격\n- remember: 80자 이내 한 문장 요약.`;

  const rows: Row[] = [];
  console.log(`[benchmark] transport=${transport} links=${links.join(',')} rounds=${rounds} model=${modelId} convert=${skipConvert ? 'skip' : 'remember'}`);

  const push = (row: Row) => rows.push(row);
  const fail = (
    link: string, kind: 'chat' | 'convert', round: number, promptChars: number,
    startedAt: number, error: unknown,
  ) => {
    push({
      at: new Date().toISOString(), link, kind, round, promptChars, ok: false,
      latencyMs: Math.round(performance.now() - startedAt), usage: emptyUsage(),
      error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    });
  };

  // 라운드로빈: 라운드마다 전 link를 돌아 시간대 편차를 상쇄한다.
  for (let round = 1; round <= rounds; round++) {
    for (const link of links) {
      const adapter = transport === 'direct' ? ADAPTERS[link as LinkName] : undefined;

      for (const prompt of CHAT_PROMPTS) {
        const startedAt = performance.now();
        try {
          if (transport === 'direct') {
            const { usage } = await adapter!.chat(prompt, { modelId, maxTokens });
            push({
              at: new Date().toISOString(), link, kind: 'chat', round,
              promptChars: prompt.length, ok: true,
              latencyMs: Math.round(performance.now() - startedAt), usage,
            });
          } else {
            const { status, json } = await postJson(`${baseUrl}/api/chat`, { prompt, maxTokens }, 120_000);
            if (status !== 200 || typeof json?.output !== 'string') {
              throw new Error(json?.error ?? `HTTP ${status}`);
            }
            push({
              at: new Date().toISOString(), link, kind: 'chat', round,
              promptChars: prompt.length, ok: true,
              latencyMs: Math.round(performance.now() - startedAt), usage: toUsage(json?.usage),
            });
          }
        } catch (error) {
          fail(link, 'chat', round, prompt.length, startedAt, error);
        }
        await sleep(delayMs);
      }

      if (!skipConvert) {
        if (transport === 'direct') {
          const startedAt = performance.now();
          try {
            const { output, usage } = await adapter!.convertStructured(convertPrompt, convertSchema, modelId);
            if (!output || typeof output !== 'object') throw new Error('모델이 스키마에 맞는 출력을 반환하지 않았습니다.');
            push({
              at: new Date().toISOString(), link, kind: 'convert', round,
              promptChars: convertPrompt.length, ok: true,
              latencyMs: Math.round(performance.now() - startedAt), usage,
            });
          } catch (error) {
            fail(link, 'convert', round, convertPrompt.length, startedAt, error);
          }
        } else {
          const startedAt = performance.now();
          try {
            const { status, json } = await postJson(
              `${baseUrl}/api/convert`,
              { blogUrl: HTTP_CONVERT_BLOG, articleUrl: HTTP_CONVERT_ARTICLE, platforms: HTTP_CONVERT_PLATFORMS },
              180_000,
            );
            if (status !== 200 || typeof json?.social?.remember !== 'string') {
              throw new Error(json?.error ?? `HTTP ${status}`);
            }
            push({
              at: new Date().toISOString(), link, kind: 'convert', round,
              promptChars: convertPrompt.length, ok: true,
              latencyMs: Math.round(performance.now() - startedAt), usage: toUsage(json?.measurement?.usage),
            });
          } catch (error) {
            fail(link, 'convert', round, convertPrompt.length, startedAt, error);
          }
        }
        await sleep(delayMs);
      }

      const done = rows.filter((r) => r.round === round && r.link === link).length;
      console.log(`  round ${round} ${link}: ${done} calls done`);
    }
  }

  const dir = join(process.cwd(), 'measurements');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(dir, `benchmark-${stamp}.json`);
  writeFileSync(jsonPath, `${JSON.stringify({ model: modelId, rounds, links, transport, baseUrl, rows }, null, 2)}\n`, 'utf8');

  console.log(`\n원시 기록: ${jsonPath}`);
  console.log('link      kind     n  ok  p50     p95     mean    prompt합 completion합');
  for (const link of links) {
    for (const kind of ['chat', 'convert'] as const) {
      if (kind === 'convert' && skipConvert) continue;
      const group = rows.filter((r) => r.link === link && r.kind === kind);
      const okRows = group.filter((r) => r.ok);
      const lat = summarizeLatencies(okRows.map((r) => r.latencyMs));
      const promptSum = okRows.reduce((a, r) => a + r.usage.promptTokens, 0);
      const completionSum = okRows.reduce((a, r) => a + r.usage.completionTokens, 0);
      console.log(
        `${link.padEnd(9)} ${kind.padEnd(8)} ${String(group.length).padEnd(2)} ${okRows.length}/${group.length} ` +
          `${String(Math.round(lat.p50)).padEnd(7)} ${String(Math.round(lat.p95)).padEnd(7)} ${String(Math.round(lat.mean)).padEnd(7)} ` +
          `${promptSum} ${completionSum}`,
      );
      for (const failed of group.filter((r) => !r.ok)) {
        console.log(`  실패 round ${failed.round}: ${failed.error}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
