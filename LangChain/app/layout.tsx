import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Blog → Social',
  description: '블로그 RSS를 4개 플랫폼용 SNS 콘텐츠로 자동 변환합니다.',
};

/**
 * 저장된 테마를 첫 페인트 전에 적용해 깜빡임(FOUC)을 막습니다.
 * 클라이언트 컴포넌트가 그리기 전에 실행되어야 해서 인라인 스크립트를 씁니다.
 */
const themeInit = `
(function () {
  try {
    var saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.dataset.theme = saved;
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}