#!/usr/bin/env node
/**
 * link 선택 부팅 래퍼. 사용법:
 *   pnpm dev link=genkit            (기본값, 생략 가능)
 *   pnpm dev link=langchain --port 3100
 *   link=langchain pnpm dev         (env 직접 주입도 가능)
 *
 * `link=xxx` 인자는 여기서 소비하고, 나머지는 그대로 `next dev`에 넘긴다.
 * pnpm이 인자를 스크립트 뒤에 붙여 `next dev link=genkit`이 되어버리는 문제를
 * 막기 위한 래퍼다 (next는 위치 인자를 디렉터리로 해석한다).
 */
import { spawn } from 'node:child_process';

const LINKS = ['genkit', 'langchain', 'mastra'];

const args = process.argv.slice(2);
let link = process.env.link ?? process.env.LINK ?? 'genkit';
const forwarded = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('link=')) {
    link = arg.slice('link='.length);
  } else if (arg === '--link' || arg === '-l') {
    link = args[++i] ?? '';
  } else if (arg.startsWith('--link=')) {
    link = arg.slice('--link='.length);
  } else {
    forwarded.push(arg);
  }
}

if (!LINKS.includes(link)) {
  console.error(`[dev] link 값이 잘못됐습니다: "${link}". genkit|langchain|mastra 중 하나를 쓰세요. 예: pnpm dev link=mastra`);
  process.exit(2);
}

// 라우트·어댑터는 lib/link.ts에서 이 값을 읽는다.
process.env.LINK = link;
console.log(`[dev] link=${link}${forwarded.length > 0 ? ` next dev ${forwarded.join(' ')}` : ' (next dev)'}`);

const child = spawn('pnpm', ['exec', 'next', 'dev', ...forwarded], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
