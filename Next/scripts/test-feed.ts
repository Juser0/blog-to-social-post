import http from 'node:http';
import https from 'node:https';

import { fetchArticle, listArticles } from '../lib/feed.ts';

const targets = process.argv.slice(2);

async function main() {
  if (targets.length === 0) {
    console.error('사용법: pnpm test:feed -- https://yourblog.com');
    process.exitCode = 1;
    return;
  }

  for (const target of targets) {
    try {
      const { feedUrl, articles } = await listArticles(target);
      console.log(`OK ${target}`);
      console.log(`  feed: ${feedUrl}`);
      console.log(`  글 수: ${articles.length}`);

      for (const article of articles.slice(0, 3)) {
        console.log(`   - ${article.title}`);
        console.log(`     ${article.link}`);
      }

      // 목록에서 고른 글로 본문을 읽을 수 있는지 확인합니다.
      const oldest = articles[articles.length - 1];
      if (oldest) {
        const article = await fetchArticle(target, oldest.link);
        console.log(`  선택 글 확인: ${article.title}`);
        console.log(`    contentSource: ${article.contentSource}`);
        console.log(`    content(${article.content.length}): ${article.content.slice(0, 100)}...`);
      }
    } catch (err) {
      console.log(`FAIL ${target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * rss-parser는 Node 전역 agent를, fetch는 undici 전역 디스패처를 씁니다.
 * 둘 다 keep-alive 소켓을 쥐고 있어서 그대로 두면 프로세스가 끝나지 않습니다.
 * 닫아 준 뒤 종료합니다. 소켓을 정리하지 않고 곧바로 exit 하면
 * 닫히는 중이던 핸들 때문에 libuv 단언이 터집니다.
 */
async function shutdown(): Promise<never> {
  const code = process.exitCode ?? 0;
  const dispatcher = (globalThis as Record<symbol, { close?: () => Promise<void> }>)[
    Symbol.for('undici.globalDispatcher.1')
  ];

  try {
    await dispatcher?.close?.();
  } catch {
    // 이미 닫혔거나 없으면 무시합니다.
  }

  // rss-parser가 쓴 Node 전역 agent의 keep-alive 소켓도 정리합니다.
  http.globalAgent.destroy();
  https.globalAgent.destroy();

  process.exit(code);
}

// keep-alive 소켓이 이벤트 루프를 붙잡지 않도록 정리한 뒤 종료합니다.
main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .then(shutdown, shutdown);