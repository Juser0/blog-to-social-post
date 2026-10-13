import { NextResponse } from 'next/server';
import { convertBlogFlow, BlogToSocialInputSchema } from '@/lib/blog-to-social';
import { appendMeasurementJsonl } from '@/lib/measure';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY가 설정되지 않았습니다. .env.local에 키를 넣고 서버를 다시 시작하세요.' },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 JSON 본문입니다.' }, { status: 400 });
  }

  const parsed = BlogToSocialInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'blogUrl이 필요합니다.', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await convertBlogFlow(parsed.data);

    appendMeasurementJsonl({
      kind: 'convert',
      at: new Date().toISOString(),
      blogUrl: parsed.data.blogUrl,
      platforms: result.platforms,
      article: result.article,
      ...result.measurement,
    });

    return NextResponse.json({
      article: {
        title: result.article.title,
        link: result.article.link,
        contentSource: result.article.contentSource,
      },
      social: result.social,
      platforms: result.platforms,
      measurement: result.measurement,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    console.error('[convertBlogFlow]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}