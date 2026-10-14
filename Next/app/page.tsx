'use client';

import { Component, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ConversionOverlay } from './ConversionOverlay';
import { PLATFORM_IDS, type PlatformId } from '@/lib/platforms';
// 타입만 불러오므로 런타임 번들에 서버 코드가 딸려 오지 않습니다.
import type { ConvertResponse } from '@/lib/schema';

type Result = ConvertResponse & { link?: string };

/**
 * 디버그 패널(원본 응답 보기·연결 표시) 노출 여부.
 * NEXT_PUBLIC_SHOW_DEBUG=true/false가 우선. 생략 시 개발(dev) 표시·배포(prod) 숨김.
 */
const SHOW_DEBUG_PANEL =
  process.env.NEXT_PUBLIC_SHOW_DEBUG === 'true' ||
  (process.env.NEXT_PUBLIC_SHOW_DEBUG !== 'false' && process.env.NODE_ENV !== 'production');

interface ArticleSummary {
  title: string;
  link: string;
  author: string;
  pubDate: string;
  categories: string[];
}

interface Listing {
  feedUrl: string;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  articles: ArticleSummary[];
}

/** id는 서버 스키마 키와 맞아야 합니다. */
const PLATFORMS: Array<{ id: PlatformId; label: string; color: string }> = [
  { id: 'linkedin', label: 'LinkedIn', color: '#4a9eff' },
  { id: 'twitter', label: 'X (Twitter)', color: '#e2e8f0' },
  { id: 'instagram', label: 'Instagram', color: '#ff5c8a' },
  { id: 'remember', label: '리마인더', color: '#f5a524' },
];

/** 카테고리 이름에 따라 배지 색을 고릅니다. 같은 이름이면 언제나 같은 색입니다. */
const CATEGORY_COLORS = [
  '#4a9eff',
  '#3ddc97',
  '#a78bfa',
  '#f5a524',
  '#ff5c8a',
  '#22d3ee',
  '#fb923c',
];

function categoryColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" className="copy-btn" onClick={handleCopy}>
      {copied ? '복사됨' : '복사'}
    </button>
  );
}

function Card({
  title,
  meta,
  copyText,
  children,
}: {
  title: string;
  meta: string;
  copyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-header">
        <span className="card-title">{title}</span>
        <span className="card-actions">
          <span className="meta">{meta}</span>
          <CopyButton text={copyText} />
        </span>
      </div>
      {children}
    </section>
  );
}

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}. ${pad(date.getMonth() + 1)}. ${pad(date.getDate())}.`;
}

/**
 * 결과 렌더 중 터지면(모델이 비정형 값을 내려보낸 경우) 빈 화면 대신
 * 에러 문구를 보여준다. 터미널을 못 보는 상태에서도 원인을 잡기 위한 장치다.
 */
class ResultBoundary extends Component<{ resetKey: number; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[result render]', error);
  }

  componentDidUpdate(prevProps: { resetKey: number }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error">
          결과 화면을 그리는 중 오류: {this.state.error.message} (서버 응답은 정상 수신됨. 아래 원본 응답을 확인하세요.)
        </div>
      );
    }
    return this.props.children;
  }
}

/** 입력창에는 프로토콜을 뗀 주소만 보여줍니다. */
function prettyUrl(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function RssIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="rss-icon">
      <circle cx="6.18" cy="17.82" r="2.18" fill="currentColor" />
      <path
        d="M4 10.5v3a7.5 7.5 0 0 1 7.5 7.5h3A10.5 10.5 0 0 0 4 10.5Z"
        fill="currentColor"
      />
      <path d="M4 4v3a13 13 0 0 1 13 13h3A16 16 0 0 0 4 4Z" fill="currentColor" />
    </svg>
  );
}

export default function Home() {
  const [blogUrl, setBlogUrl] = useState('');
  const [listing, setListing] = useState<Listing | null>(null);

  const [loadingList, setLoadingList] = useState(false);
  const [convertingLink, setConvertingLink] = useState<string | null>(null);
  const [convertingTitle, setConvertingTitle] = useState('');

  // 변환을 시작한 글. 목록에서 그 위치를 표시하고 스크롤 기준으로 씁니다.
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const selectedRef = useRef<HTMLLIElement | null>(null);

  // 취소 버튼이 fetch를 실제로 끊습니다.
  const abortRef = useRef<AbortController | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  // 변환 시도 횟수. 결과 렌더가 터졌던 상태(ResultBoundary)를 다음 시도 때 리셋한다.
  const [convertSeq, setConvertSeq] = useState(0);

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [category, setCategory] = useState<string>('전체');

  // 기본은 전체 선택입니다. 하나도 고르지 않으면 변환 버튼을 막습니다.
  const [platforms, setPlatforms] = useState<PlatformId[]>([...PLATFORM_IDS]);

  function togglePlatform(id: PlatformId) {
    setPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* 시크릿 모드 등 저장 실패는 무시합니다. */
    }
  }

  // 결과가 그려진 뒤에 선택한 글의 시작점을 화면 맨 위로 올립니다.
  useEffect(() => {
    if (!result || !selectedLink) return;

    // 변환 결과가 나타난 위치로 부드럽게 스크롤합니다.
    const resultBox = document.querySelector('.cards');
    if (resultBox) {
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result, selectedLink]);

  async function loadList() {
    if (!blogUrl.trim()) return;

    setLoadingList(true);
    setError(null);

    try {
      const res = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogUrl: blogUrl.trim(), page: 1 }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `요청 실패 (${res.status})`);
      }

      setListing(data as Listing);
      setCategory('전체');
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
      setListing(null);
    } finally {
      setLoadingList(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadList();
  }

  function cancelConvert() {
    abortRef.current?.abort();
    abortRef.current = null;
    setConvertingLink(null);
    setConvertingTitle('');
    setError('변환을 취소했습니다.');
  }

  async function handleConvert(articleUrl: string, articleTitle: string) {
    // 목록을 켜 둔 상태가 여기서 읽힙니다.
    if (platforms.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setConvertingLink(articleUrl);
    setConvertingTitle(articleTitle);
    setSelectedLink(articleUrl);
    setConvertSeq((n) => n + 1);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blogUrl: blogUrl.trim(),
          articleUrl,
          // 고른 시점의 목록을 그대로 보냅니다.
          platforms: [...platforms],
        }),
        signal: controller.signal,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `요청 실패 (${res.status})`);
      }
      setResult(data as Result);
    } catch (err) {
      // 사용자가 취소한 경우에는 오류로 다루지 않습니다.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setConvertingLink(null);
      setConvertingTitle('');
    }
  }

  // 카테고리 칩은 현재 페이지에 실제로 있는 값만 노출합니다.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const article of listing?.articles ?? []) {
      for (const c of article.categories) set.add(c);
    }
    return ['전체', ...[...set]];
  }, [listing]);

  const visible = useMemo(() => {
    if (!listing) return [];
    if (category === '전체') return listing.articles;
    return listing.articles.filter((a) => a.categories.includes(category));
  }, [listing, category]);

  return (
    <main>
      <div className="topbar">
        <span className="brand">
          <span className="live-dot" />
          RSS Feed Sync Engine
        </span>
        <span className="topbar-right">
          <span className="version">v2.4</span>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </span>
      </div>

      <header className="hero">
        <div className="hero-row">
          <span className="rss-box">
            <RssIcon />
          </span>
          <h1>
            Blog <span className="arrow">→</span> <span className="accent-text">Social</span>
          </h1>
          <span className="engine-badge">⚡ AI Engine</span>
        </div>
        <p className="subtitle">
          블로그 RSS 글 목록에서 원하는 글을 골라 LinkedIn / 리마인더 / X / 인스타그램용 콘텐츠로
          변환합니다.
        </p>
        <div className="platforms" role="group" aria-label="만들 플랫폼 선택">
          {PLATFORMS.map((p) => {
            const on = platforms.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={on ? 'platform-chip on' : 'platform-chip'}
                aria-pressed={on}
                onClick={() => togglePlatform(p.id)}
              >
                <span className="dot" style={{ background: on ? p.color : undefined }} />
                {p.label}
                <span className="check">{on ? '✓' : ''}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="platform-chip link"
            onClick={() => setPlatforms([...PLATFORM_IDS])}
            disabled={platforms.length === PLATFORM_IDS.length}
          >
            전체 선택
          </button>
        </div>

        {platforms.length === 0 && (
          <p className="platform-warn">만들 플랫폼을 하나 이상 선택하세요.</p>
        )}
      </header>

      <form onSubmit={handleSubmit} className="url-card">
        <div className="url-input-wrap">
          <span className="globe">🌐</span>
          <input
            type="text"
            value={blogUrl}
            onChange={(e) => setBlogUrl(e.target.value)}
            placeholder="justuser.tistory.com"
            aria-label="블로그 URL"
          />
          {blogUrl && (
            <button
              type="button"
              className="clear-btn"
              onClick={() => setBlogUrl('')}
              aria-label="지우기"
            >
              ✕
            </button>
          )}
        </div>
        <button type="submit" className="primary-btn" disabled={loadingList || !blogUrl.trim()}>
          <span className="spin-wrap">{loadingList ? '⟳' : '⟳'}</span>
          {loadingList ? '불러오는 중...' : '글 목록 불러오기'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {listing && (
        <>
          <div className="list-header">
            <span>
              <span className="live-dot small" />
              전체 {listing.total}개 중 {visible.length}개 표시 ({listing.page}/{listing.pageCount}{' '}
              페이지)
            </span>
            <a className="feed-link" href={listing.feedUrl} target="_blank" rel="noreferrer">
              RSS 원본 ↗
            </a>
          </div>

          {categories.length > 2 && (
            <div className="category-row">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={c === category ? 'cat-chip active' : 'cat-chip'}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <ul className="article-list">
            {visible.map((article) => {
              const busy = convertingLink === article.link;
              const selected = selectedLink === article.link;
              const badge = article.categories[0];

              return (
                <li
                  key={article.link || article.title}
                  ref={selected ? selectedRef : null}
                  className={busy ? 'article busy' : selected ? 'article selected' : 'article'}
                >
                  <div className="article-head">
                    {badge ? (
                      <span
                        className="cat-badge"
                        style={{ color: categoryColor(badge), borderColor: categoryColor(badge) }}
                      >
                        {badge}
                      </span>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      className="convert-btn"
                      disabled={convertingLink !== null || platforms.length === 0}
                      onClick={() => handleConvert(article.link, article.title)}
                    >
                      {busy ? '변환 중...' : '⚡ 변환하기'}
                    </button>
                  </div>
                  <span className="article-title">{article.title || '(제목 없음)'}</span>
                  <span className="article-meta">
                    {[formatDate(article.pubDate), article.author].filter(Boolean).join(' · ')}
                  </span>
                  {article.link && (
                    <a className="article-link" href={article.link} target="_blank" rel="noreferrer">
                      {prettyUrl(article.link)} <span className="ext">↗</span>
                    </a>
                  )}
                </li>
              );
            })}

            {visible.length === 0 && <li className="article empty">해당 카테고리 글이 없습니다.</li>}
          </ul>

          {listing.pageCount > 1 && (
            <nav className="pager" aria-label="페이지 이동">
              <button
                type="button"
                className="pager-step"
                disabled={listing.page <= 1}
                onClick={() => {
                  setLoadingList(true);
                  fetch('/api/articles', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ blogUrl: blogUrl.trim(), page: listing.page - 1 }),
                  })
                    .then((r) => r.json())
                    .then((d) => {
                      setListing(d);
                      setCategory('전체');
                      setResult(null);
                    })
                    .catch((e) => setError(String(e)))
                    .finally(() => setLoadingList(false));
                }}
              >
                ‹
              </button>
              <span className="pager-label">
                Page {listing.page} / {listing.pageCount}
              </span>
              <button
                type="button"
                className="pager-step"
                disabled={listing.page >= listing.pageCount}
                onClick={() => {
                  setLoadingList(true);
                  fetch('/api/articles', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ blogUrl: blogUrl.trim(), page: listing.page + 1 }),
                  })
                    .then((r) => r.json())
                    .then((d) => {
                      setListing(d);
                      setCategory('전체');
                      setResult(null);
                    })
                    .catch((e) => setError(String(e)))
                    .finally(() => setLoadingList(false));
                }}
              >
                ›
              </button>
            </nav>
          )}

          <footer className="page-footer">Powered by AI Social Formatter · RSS</footer>
        </>
      )}

      {convertingLink && (
        <ConversionOverlay
          articleTitle={convertingTitle}
          platforms={platforms}
          onCancel={cancelConvert}
        />
      )}

      {result && (
        <ResultBoundary resetKey={convertSeq}>
          <div className="source">
            <span className="source-label">
              {result.article.contentSource === 'page' ? '원문 페이지에서 읽음' : 'RSS에서 읽음'}
            </span>
            {SHOW_DEBUG_PANEL && <span className="source-label">연결: {result.link ?? '?'}</span>}
            {result.article.link ? (
              <a className="source-title" href={result.article.link} target="_blank" rel="noreferrer">
                {result.article.title}
              </a>
            ) : (
              <span className="source-title">{result.article.title}</span>
            )}
          </div>

          {/* .cards는 opacity: 0 시작이므로 visible을 함께 붙여야 보인다. */}
          <div className="cards visible">
            {typeof result.social.linkedin === 'string' && (
              <Card
                title="LinkedIn"
                meta={`${result.social.linkedin.length}자`}
                copyText={result.social.linkedin}
              >
                <p className="card-body">{result.social.linkedin}</p>
              </Card>
            )}

            {typeof result.social.remember === 'string' && (
              <Card
                title="리마인더"
                meta={`${result.social.remember.length}자`}
                copyText={result.social.remember}
              >
                <p className="card-body">{result.social.remember}</p>
              </Card>
            )}

            {typeof result.social.twitter === 'string' && (
              <Card
                title="X (Twitter)"
                meta={`${result.social.twitter.length}자`}
                copyText={result.social.twitter}
              >
                <p className="card-body">{result.social.twitter}</p>
              </Card>
            )}

            {result.social.instagram &&
              Array.isArray(result.social.instagram.cardNews) &&
              result.social.instagram.cardNews.length > 0 && (
                <Card
                  title="Instagram - 카드뉴스"
                  meta={`${result.social.instagram.cardNews.length}장`}
                  copyText={result.social.instagram.cardNews.join('\n\n')}
                >
                  <ul className="card-news-list">
                    {result.social.instagram.cardNews.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </Card>
              )}

            {result.social.instagram && typeof result.social.instagram.caption === 'string' && (
              <Card
                title="Instagram - 캡션"
                meta={`${result.social.instagram.caption.length}자`}
                copyText={result.social.instagram.caption}
              >
                <p className="card-body">{result.social.instagram.caption}</p>
              </Card>
            )}
          </div>

          {SHOW_DEBUG_PANEL && (
            <details className="raw">
              <summary>원본 응답 보기 (문제 생기면 이 내용을 복사해서 알려주세요)</summary>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </details>
          )}
        </ResultBoundary>
      )}
    </main>
  );
}