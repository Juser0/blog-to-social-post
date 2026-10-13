/**
 * RSS 피드가 주는 본문은 대개 요약(snippet) 수준이라 그대로 AI에 넣으면 근거가 없습니다.
 * 그래서 원문 페이지 HTML에서 실제 본문 텍스트를 뽑아 쓰는 단계입니다.
 */

/** HTML 엔티티를 일반 문자로 되돌립니다. */
function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&hellip;/gi, '...')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .trim();
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** 본문이 아닌 영역을 제거합니다. */
function removeNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|form|nav|aside|footer|header)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|form|nav|aside|footer|header)\b[^>]*>/gi, ' ');
}

/** 블록 경계에 줄바꿈을 넣습니다. */
function markBlockBoundaries(html: string): string {
  return html
    .replace(/<\/?(p|div|section|article|br|li|ul|ol|tr|td|h[1-6]|blockquote|pre|figure|figcaption|hr)\b[^>]*>/gi, '\n');
}

/**
 * 가장 적절한 본문 컨테이너를 고릅니다.
 * `<article>` 안에 `<article>`가 중첩될 수 있어 시작 태그는 첫 것, 종료 태그는 마지막 것을 씁니다.
 */
function pickContentRegion(html: string): string {
  const candidates: Array<{ start: RegExp; label: string }> = [
    { start: /<article\b[^>]*>/i, label: 'article' },
    { start: /<main\b[^>]*>/i, label: 'main' },
    { start: /<[a-z]+[^>]*itemprop\s*=\s*["']articleBody["'][^>]*>/i, label: 'articleBody' },
  ];

  for (const { start, label } of candidates) {
    const startMatch = start.exec(html);
    if (!startMatch) continue;

    const tagName = startMatch[0].match(/^<([a-z]+)/i)?.[1] ?? label;
    const bodyStart = startMatch.index + startMatch[0].length;
    const endIdx = html.toLowerCase().lastIndexOf(`</${tagName}>`);
    if (endIdx <= bodyStart) continue;

    return html.slice(bodyStart, endIdx);
  }

  return html;
}

export function htmlToText(html: string): string {
  return decodeEntities(
    removeNoise(html)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  );
}

/** 원문 HTML에서 읽을 만한 본문 텍스트를 추출합니다. */
export function extractArticleText(html: string): string {
  const region = pickContentRegion(removeNoise(html));

  const text = decodeEntities(
    markBlockBoundaries(region)
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n'),
  ).trim();

  if (text.length >= 400) return text;

  // 컨테이너를 못 찾았거나 너무 짧으면 전체 문서에서 한 번 더 시도합니다.
  return htmlToText(html);
}

const FETCH_TIMEOUT_MS = 10_000;

/** 원문 페이지에서 본문을 긁어옵니다. 실패하면 빈 문자열을 돌려줍니다. */
export async function fetchArticleText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; BlogToSocial/1.0; +https://nextjs.org)',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) return '';

    const html = await res.text();
    return extractArticleText(html);
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}