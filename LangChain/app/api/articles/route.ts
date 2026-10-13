import { NextResponse } from 'next/server';
import { listArticles } from '@/lib/feed';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** 한 페이지에 보여줄 글 수 */
export const PAGE_SIZE = 10;

const ListInputSchema = z.object({
  blogUrl: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 JSON 본문입니다.' }, { status: 400 });
  }

  const parsed = ListInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'blogUrl이 필요합니다.', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { blogUrl, page } = parsed.data;

  try {
    const { feedUrl, articles } = await listArticles(blogUrl);
    const pageCount = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));

    // 마지막 페이지를 넘겨서 요청한 경우 마지막 페이지로 맞춰줍니다.
    const currentPage = Math.min(page, pageCount);
    const start = (currentPage - 1) * PAGE_SIZE;

    return NextResponse.json({
      feedUrl,
      page: currentPage,
      pageCount,
      total: articles.length,
      pageSize: PAGE_SIZE,
      articles: articles.slice(start, start + PAGE_SIZE),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    console.error('[listArticles]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}