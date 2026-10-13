import { z } from 'genkit';
import { ai, defaultModel } from './ai.ts';
import { fetchArticle, type FeedArticle } from './feed.ts';
import {
  ArticleInfoSchema,
  buildSocialOutputSchema,
  normalizePlatforms,
  PartialSocialOutputSchema,
  type PlatformId,
} from './schema.ts';

export const BlogToSocialInputSchema = z.object({
  blogUrl: z.string().min(1).describe('RSS 피드를 제공하는 블로그 URL'),
  /** 목록에서 고른 글의 주소. 비우면 가장 최신 글을 씁니다. */
  articleUrl: z.string().optional().describe('변환할 글의 URL. 목록에서 선택'),
  /** 만들어 줄 플랫폼. 비우면 전체를 만듭니다. */
  platforms: z.array(z.string()).optional().describe('만들 플랫폼 목록'),
});

/** 이 길이보다 짧으면 근거가 부족해 SNS 콘텐츠를 뽑아낼 수 없습니다. */
const MIN_USABLE_CONTENT_CHARS = 300;

/**
 * 아주 긴 글이 통째로 들어가면 지연시간과 비용만 커집니다.
 * SNS 콘텐츠를 뽑는 데 앞부분 위주로 충분하다고 보고 잘라서 보냅니다.
 */
const MAX_PROMPT_CONTENT_CHARS = 40_000;

function trimForPrompt(content: string): string {
  if (content.length <= MAX_PROMPT_CONTENT_CHARS) return content;

  const clipped = content.slice(0, MAX_PROMPT_CONTENT_CHARS);
  const lastBreak = clipped.lastIndexOf('\n');
  return `${lastBreak > MAX_PROMPT_CONTENT_CHARS * 0.8 ? clipped.slice(0, lastBreak) : clipped}\n\n(원문 중간에서 잘렸습니다.)`;
}

/** 플랫폼별 지시. 고른 플랫폼에 대해서만 프롬프트에 넣습니다. */
const PLATFORM_RULES: Record<PlatformId, string> = {
  linkedin:
    '- linkedin: 1200자 이내. 첫 줄에 임팩트 있는 한 줄 후킹, 이후 줄바꿈을 넣어 읽기 쉽게 작성. 마지막에 해시태그를 덧붙이지 마세요.',
  remember: '- remember: 80자 이내 한 문장 요약.',
  twitter: '- twitter: 280자 이내. 하나의 강한 주장 + 근거.',
  instagram: [
    '- instagram.cardNews: 정확히 5개의 문자열. 각 문자열은 "1. 제목 - 본문" 형식이며, 5장을 이어 읽으면 하나의 서사가 되도록 구성.',
    '- instagram.caption: 인스타그램 본문 + 관련 해시태그 5~10개.',
  ].join('\n'),
};

/**
 * 고른 플랫폼에 맞는 프롬프트를 만듭니다.
 * 필요 없는 플랫폼을 지시하면 그만큼만 비용과 시간이 줄어듭니다.
 */
function buildPrompt(title: string, content: string, platforms: readonly PlatformId[]): string {
  // 해시태그 규칙은 인스타그램을 고른 경우에만 의미가 있습니다.
  const hashtagRule = platforms.includes('instagram')
    ? '- 해시태그는 instagram.caption에만 넣습니다. 다른 항목에는 #을 절대 넣지 마세요.'
    : '- 어떤 항목에도 해시태그를 넣지 마세요.';

  return `아래는 블로그 글입니다. 이 글의 핵심을 요청한 SNS 플랫폼의 톤과 규격에 맞게 재구성하세요.

## 원문
제목: ${title}

${content}

## 작성 규칙 (모든 항목에 공통으로 적용)
- 원문에 없는 사실을 지어내지 마세요. 단정할 수 없으면 "~할 수 있습니다" 같은 완곡한 표현을 쓰세요.
- 마크다운 기호를 쓰지 말고 순수 텍스트만 출력하세요. 역따옴표나 별표로 코드나 항목을 강조하지 말고, 필요한 함수명이나 속성명은 그냥 적으세요. 목록이 필요하면 "- "로 시작하세요.
${hashtagRule}

## 플랫폼별 규격
${platforms.map((id) => PLATFORM_RULES[id]).join('\n')}`;
}

/**
 * Gemini는 트래픽이 몰릴 때 503(UNAVAILABLE)이나 429를 간헐적으로 반환합니다.
 * 실제로 앱이 503으로 실패하는 경우를 확인했으므로, 일시적인 오류만 짧게 재시도합니다.
 * 400/404 같은 영구 오류는 재시도해도 소용없으므로 바로 실패시킵니다.
 */
const RETRYABLE = /UNAVAILABLE|RESOURCE_EXHAUSTED|\[503|\[429|high demand|try again later/i;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(prompt: string, platforms: readonly PlatformId[]) {
  let lastError: unknown;

  // 고른 플랫폼에 해당하는 항목만 스키마에 담아 고라고 합니다.
  const outputSchema = buildSocialOutputSchema(platforms);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await ai.generate({
        model: defaultModel,
        prompt,
        output: { schema: outputSchema },
      });
    } catch (error) {
      lastError = error;

      const message = error instanceof Error ? error.message : String(error);
      if (!RETRYABLE.test(message)) throw error;

      if (attempt === MAX_ATTEMPTS) {
        // 재시도해도 503이면 설정 문제가 아니라 OpenRouter 쪽 트래픽 문제이므로 구분해서 알려줍니다.
        throw new Error(
          `OpenRouter가 ${MAX_ATTEMPTS}회 연속 트래픽 혼잡(503)을 반환했습니다. ` +
            `:free 티어는 혼잡할 때가 많으니 잠시 후 다시 시도하거나, ` +
            `.env.local의 OPENROUTER_MODEL을 다른 모델로 바꿔 보세요.`,
        );
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError;
}

/** 블로그 RSS 1편을 읽어 4개 플랫폼용 콘텐츠로 변환하는 플로우. */
export const convertBlogFlow = ai.defineFlow(
  {
    name: 'convertBlogFlow',
    inputSchema: BlogToSocialInputSchema,
    outputSchema: z.object({
      article: ArticleInfoSchema,
      social: PartialSocialOutputSchema,
      platforms: z.array(z.enum(['linkedin', 'remember', 'twitter', 'instagram'])),
    }),
  },
  async ({ blogUrl, articleUrl, platforms: requested }) => {
    const platforms = normalizePlatforms(requested);
    const article: FeedArticle = await fetchArticle(blogUrl, articleUrl);

    if (article.content.length < MIN_USABLE_CONTENT_CHARS) {
      throw new Error(
        `글 본문을 거의 읽지 못했습니다 (${article.content.length}자). ` +
          `RSS가 요약만 제공하고 원문 페이지도 읽지 못한 것 같으니, 다른 블로그 URL을 시도해 보세요.`,
      );
    }

    const { output } = await generateWithRetry(
      buildPrompt(article.title, trimForPrompt(article.content), platforms),
      platforms,
    );

    if (!output) {
      throw new Error('모델이 스키마에 맞는 출력을 반환하지 않았습니다.');
    }

    return {
      article: {
        title: article.title,
        link: article.link,
        contentSource: article.contentSource,
      },
      social: output,
      platforms,
    };
  },
);

export { convertBlogFlow as default };