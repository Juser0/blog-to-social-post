/**
 * 플랫폼 목록은 서버와 클라이언트가 함께 씁니다.
 * zod나 genkit를 불러오면 안 됩니다. 이 파일을 클라이언트 컴포넌트가 import하기 때문입니다.
 * (런타임 값을 import하면 번들에 서버 전용 코드가 딸려 들어옵니다.)
 */

export const PLATFORM_IDS = ['linkedin', 'remember', 'twitter', 'instagram'] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];