import { z } from 'zod';
import { PLATFORM_IDS, type PlatformId } from './platforms.ts';

export { PLATFORM_IDS, type PlatformId };

const LinkedInSchema = z.string().describe('LinkedIn 피드에 올릴 전문(1200자 이내)');
const RememberSchema = z.string().describe('리마인더(알림)용 짧은 한 줄 요약(80자 이내)');
const TwitterSchema = z.string().describe('X(트위터)용 트윗 본문(280자 이내)');
const InstagramSchema = z.object({
  cardNews: z
    .array(z.string())
    .length(5)
    .describe('카드뉴스 5장 구성안. 각 항목은 "장번호. 제목 - 핵심 본문" 형태의 한 줄 문자열'),
  caption: z.string().describe('인스타그램 캡션(해시태그 포함)'),
});

/** 플랫폼별 스키마 조각. 동적 스키마를 만들 때 재사용합니다. */
export const PLATFORM_FIELDS: Record<PlatformId, z.ZodTypeAny> = {
  linkedin: LinkedInSchema,
  remember: RememberSchema,
  twitter: TwitterSchema,
  instagram: InstagramSchema,
};

export const SocialOutputSchema = z.object({
  linkedin: LinkedInSchema,
  remember: RememberSchema,
  twitter: TwitterSchema,
  instagram: InstagramSchema,
});

export type SocialOutput = z.infer<typeof SocialOutputSchema>;

/** 사용자가 고른 플랫폼만 채워지는 부분 출력입니다. */
export const PartialSocialOutputSchema = z.object({
  linkedin: LinkedInSchema.optional(),
  remember: RememberSchema.optional(),
  twitter: TwitterSchema.optional(),
  instagram: InstagramSchema.optional(),
});

export type PartialSocialOutput = z.infer<typeof PartialSocialOutputSchema>;

/** 고른 플랫폼에 해당하는 항목만 가진 스키마를 만듭니다. 고르지 않은 항목은 생략됩니다. */
export function buildSocialOutputSchema(platforms: readonly PlatformId[]) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const id of platforms) {
    shape[id] = PLATFORM_FIELDS[id];
  }

  return z.object(shape);
}

/** 입력을 안전하게 정규화합니다. 알 수 없는 값은 버리고, 비어 있으면 전체를 씁니다. */
export function normalizePlatforms(input: unknown): PlatformId[] {
  const requested = Array.isArray(input) ? input : [];
  const picked = PLATFORM_IDS.filter((id) => requested.includes(id));
  return picked.length > 0 ? picked : [...PLATFORM_IDS];
}

/** API 응답에 함께 붙여 보내는 원문 글 정보입니다. */
export const ArticleInfoSchema = z.object({
  title: z.string(),
  link: z.string(),
  contentSource: z.enum(['feed', 'page']),
});

export type ArticleInfo = z.infer<typeof ArticleInfoSchema>;

export const ConvertResponseSchema = z.object({
  article: ArticleInfoSchema,
  social: PartialSocialOutputSchema,
  /** 실제로 만들어진 플랫폼 목록입니다. */
  platforms: z.array(z.enum(PLATFORM_IDS)),
});

export type ConvertResponse = z.infer<typeof ConvertResponseSchema>;