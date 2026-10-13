import Parser from 'rss-parser';
import { fetchArticleText, htmlToText } from './article.ts';

const FEED_HEADERS: Record<string, string> = {
  // rss-parser 기본값은 'application/rss+xml' 하나뿐이라 Atom이나 일반 XML을 알지 못합니다.
  // 실제 피드 서버 대다수는 Accept를 무시하지만, Content-Type 협상을 하는 서버까지 대비해
  // RSS/Atom/XML/text-xml을 모두 적어 보냅니다. 좁게 보내면 406을 받을 수 있으니 넓게 씁니다.
  Accept:
    'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (compatible; BlogToSocial/1.0; +https://nextjs.org)',
};

const parser = new Parser({
  customFields: {
    item: [['content:encoded', 'contentEncoded', { keepArray: false }]],
  },
});

const CANDIDATE_FEEDS = [
  '/rss',
  '/feed',
  '/feed.xml',
  '/rss.xml',
  '/atom.xml',
  '/index.xml',
  '/rss.php',
  '/feed.php',
];

/**
 * 후보를 순서대로 여러 개 시도하므로 개별 제한은 짧게 두되,
 * 느린 서버(실측 12초)를 잘라내지 않도록 10초보다 넉넉하게 잡습니다.
 */
const FEED_TIMEOUT_MS = 20_000;

/**
 * 후보를 전부 시도해도 최대 9 x 20초라 API의 실행 시간 제한(60초)을 넘겨버립니다.
 * 대개 404로 빠르게 끝나지만, 연결 자체가 느린 호스트는 전부 타임아웃으로 시간을 채웁니다.
 * 그래서 전체 탐색 시간 자체에도 상한을 둡니다.
 */
const FEED_SEARCH_BUDGET_MS = 25_000;

/**
 * 이 길이보다 짧으면 RSS가 요약만 준 것으로 보고 원문 페이지를 긁어옵니다.
 * 피드마다 본문을 주는 정도가 달라 대략적인 기준으로 잡습니다.
 */
const MIN_FULL_CONTENT_CHARS = 800;

export interface FeedArticle {
  title: string;
  link: string;
  author: string;
  pubDate: string;
  content: string;
  sourceFeed: string;
  /** 본문을 RSS에서 얻었는지, 원문 페이지를 긁어왔는지. */
  contentSource: 'feed' | 'page';
}

/** 목록 화면에 쓰는 요약 정보. 본문을 긁지 않으므로 응답이 빠릅니다. */
export interface FeedSummary {
  title: string;
  link: string;
  author: string;
  pubDate: string;
  /** RSS의 category 태그. Tistory처럼 '기록/회고' 형태면 마지막 단계만 씁니다. */
  categories: string[];
}

export interface FeedListing {
  feedUrl: string;
  articles: FeedSummary[];
}

/** customFields로 받는 content:encoded는 기본 Item 타입에 없어 직접 붙여 씁니다. */
interface FeedItem extends Parser.Item {
  contentEncoded?: string;
}

/** 파싱된 피드 한 건과 원본 아이템 목록. */
interface ResolvedFeed {
  feedUrl: string;
  items: FeedItem[];
}

function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  url.hash = '';
  url.search = '';
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/**
 * 피드에 있는 주소와 사용자가 고른 주소를 비교하기 위한 정규화.
 * 뒤에 붙은 슬래시나 index.html 같은 차이를 무시합니다.
 */
function normalizeArticleUrl(input: string): string {
  if (!input) return '';

  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    const path = url.pathname.replace(/\/+$/, '').replace(/\/(index|default)\.[a-z]+$/i, '');
    return `${url.origin}${path}`.toLowerCase();
  } catch {
    return input.trim().toLowerCase();
  }
}

/** 피드가 요약만 줬을 때 원문 페이지에서 본문을 보충합니다. 실패하면 원래 내용을 그대로 둡니다. */
async function resolveFullContent(
  link: string,
  feedContent: string,
): Promise<{ content: string; source: FeedArticle['contentSource'] }> {
  if (feedContent.length >= MIN_FULL_CONTENT_CHARS) {
    return { content: feedContent, source: 'feed' };
  }

  if (!link) {
    return { content: feedContent, source: 'feed' };
  }

  const scraped = await fetchArticleText(link);
  if (scraped.length > feedContent.length) {
    return { content: scraped, source: 'page' };
  }

  return { content: feedContent, source: 'feed' };
}

/**
 * 피드 문서를 직접 받아 온다.
 * parser.parseURL을 쓰면 상태 코드와 Content-Type을 볼 수 없어서,
 * 클라우드플레어 챌린지 페이지 같은 HTML을 'Unexpected close tag' 같은 엉뚱한 오류로 보여줍니다.
 */
async function fetchFeedXml(feedUrl: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(feedUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: FEED_HEADERS,
    });
  } catch (err) {
    // 이유를 그대로 보여줘야 어느 지점에서 막혔는지 알 수 있습니다.
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`응답 시간 초과 (${timeoutMs / 1000}초)`);
    }
    const cause = (err as { cause?: { code?: string } })?.cause?.code;
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(cause ? `요청 실패 (${cause})` : `요청 실패 (${reason})`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`상태 코드 ${res.status}`);
  }

  const body = await res.text();
  const contentType = res.headers.get('content-type') ?? '';

  // RSS를 두지 않는 블로그가 /rss 경로에 HTML을 그대로 서빙하는 경우가 많습니다.
  if (/^\s*(<!doctype html|<html)/i.test(body)) {
    if (/just a moment|cf-browser-verification|challenge-platform/i.test(body)) {
      throw new Error('Cloudflare 등 봇 방어벽에 막혔습니다');
    }
    throw new Error(`HTML이 반환됨 (content-type: ${contentType || '없음'})`);
  }

  return body;
}

/**
 * 블로그 RSS/Atom 피드 중 가장 먼저 응답하는 주소를 찾아 파싱한다.
 * 목록 조회와 본문 변환이 같은 경로를 쓰도록 피드 해석을 한 곳에 모았습니다.
 */
async function resolveFeed(blogUrl: string): Promise<ResolvedFeed> {
  const base = normalizeBaseUrl(blogUrl);
  const errors: string[] = [];
  const startedAt = Date.now();

  for (const path of CANDIDATE_FEEDS) {
    const remaining = FEED_SEARCH_BUDGET_MS - (Date.now() - startedAt);
    if (remaining <= 0) {
      errors.push('탐색 시간 초과로 나머지 경로는 시도하지 않음');
      break;
    }

    const feedUrl = `${base}${path}`;
    try {
      const feed = await parser.parseString(
        await fetchFeedXml(feedUrl, Math.min(FEED_TIMEOUT_MS, remaining)),
      );
      const items = (feed.items ?? []) as FeedItem[];
      if (items.length === 0) {
        errors.push(`${feedUrl}: 아이템 없음`);
        continue;
      }

      return { feedUrl, items };
    } catch (err) {
      errors.push(`${feedUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`RSS 피드를 찾을 수 없습니다. tried -> ${errors.join(' | ')}`);
}

/** '기록/회고' 같은 경로형 category에서 표시할 이름만 뽑아냅니다. */
function toCategoryLabels(categories: unknown): string[] {
  if (!Array.isArray(categories)) return [];

  const labels = categories
    .flatMap((entry) => (typeof entry === 'string' ? [entry] : []))
    .map((entry) => entry.split('/').pop()?.trim() ?? '')
    .filter((label) => label !== '');

  return [...new Set(labels)];
}

function toSummary(item: FeedItem): FeedSummary {
  return {
    title: (item.title ?? '').trim(),
    link: item.link ?? '',
    author: item.creator ?? (item as { author?: string }).author ?? '',
    pubDate: item.isoDate ?? item.pubDate ?? '',
    categories: toCategoryLabels(item.categories),
  };
}

/** 피드에 실린 글 목록을 피드 순서(보통 최신순) 그대로 반환합니다. 본문은 긁지 않습니다. */
export async function listArticles(blogUrl: string): Promise<FeedListing> {
  const { feedUrl, items } = await resolveFeed(blogUrl);

  const articles = items
    .map(toSummary)
    // 제목도 주소도 비어 있는 항목은 목록에서 의미가 없습니다.
    .filter((a) => a.title !== '' || a.link !== '');

  return { feedUrl, articles };
}

/**
 * 글 하나를 골라 본문을 확보합니다.
 * articleUrl을 주면 피드에서 해당 글을 찾아가고, 없으면 가장 최신 글을 씁니다.
 */
export async function fetchArticle(blogUrl: string, articleUrl?: string): Promise<FeedArticle> {
  const { feedUrl, items } = await resolveFeed(blogUrl);

  let item: FeedItem | undefined;
  if (articleUrl) {
    const wanted = normalizeArticleUrl(articleUrl);
    item = items.find((candidate) => normalizeArticleUrl(candidate.link ?? '') === wanted);
    if (!item) {
      throw new Error('피드 목록에서 해당 글을 찾지 못했습니다. 목록을 다시 불러와 주세요.');
    }
  } else {
    item = items[0];
  }

  const raw = item.contentEncoded || item.content || item.contentSnippet || '';
  const feedContent = htmlToText(raw);
  const link = item.link ?? '';
  const { content, source } = await resolveFullContent(link, feedContent);

  return {
    title: item.title ?? '',
    link: link || feedUrl,
    author: item.creator ?? (item as { author?: string }).author ?? '',
    pubDate: item.isoDate ?? item.pubDate ?? '',
    content,
    sourceFeed: feedUrl,
    contentSource: source,
  };
}