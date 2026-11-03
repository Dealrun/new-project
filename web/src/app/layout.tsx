import type { Metadata } from 'next';
import { ReactNode } from 'react';
import { Toaster } from '@/components/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'OnDuty',
  description: '당직·일직·비상대기·차출 근무 자동 편성과 알림',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
