import { NextResponse } from 'next/server';
import { convertBlogFlow, BlogToSocialInputSchema } from '@/lib/blog-to-social';
import { missingApiKeyReason } from '@/lib/adapters/index';
import { LINK } from '@/lib/link';
import { appendMeasurementJsonl } from '@/lib/measure';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const keyReason = missingApiKeyReason();
  if (keyReason) {
    return NextResponse.json({ error: keyReason }, { status: 500 });
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

    appendMeasurementJsonl(
      {
        kind: 'convert',
        at: new Date().toISOString(),
        blogUrl: parsed.data.blogUrl,
        platforms: result.platforms,
        article: result.article,
        ...result.measurement,
      },
      `${LINK}.jsonl`,
    );

    // 디버그용: 모델이 실제로 뭘 내려보냈는지 형태만 1줄 남긴다 (내용 전문 아님).
    console.log(
      `[convert:${LINK}] social shape:`,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(result.social ?? {}).map(([key, value]) => [
            key,
            Array.isArray(value) ? `array(${value.length})` : typeof value,
          ]),
        ),
      ),
    );

    return NextResponse.json({
      article: {
        title: result.article.title,
        link: result.article.link,
        contentSource: result.article.contentSource,
      },
      social: result.social,
      platforms: result.platforms,
      measurement: result.measurement,
      link: LINK,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    console.error('[convertBlogFlow]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}