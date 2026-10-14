/**
 * 부팅 시 AI 연결 선택. `pnpm dev link=genkit|langchain` (scripts/dev.mjs가
 * LINK env로 넘긴다) 또는 `link=xxx pnpm dev` 직접 주입을 읽는다.
 * 값이 잘못되면 import 시점에 throw → 부팅 실패로 바로 드러난다.
 */
export const LINK_NAMES = ['genkit', 'langchain'] as const;

export type LinkName = (typeof LINK_NAMES)[number];

const DEFAULT_LINK: LinkName = 'genkit';

function parseLink(raw: string | undefined): LinkName {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return DEFAULT_LINK;
  if ((LINK_NAMES as readonly string[]).includes(value)) return value as LinkName;

  throw new Error(
    `[ai] link 값이 잘못됐습니다: "${raw}". genkit|langchain 중 하나를 쓰세요. 예: pnpm dev link=genkit`,
  );
}

/** 서버 부팅 시점에 확정되는 활성 어댑터 이름. */
export const LINK: LinkName = parseLink(process.env.link ?? process.env.LINK);
