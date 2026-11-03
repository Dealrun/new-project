import { ImageResponse } from 'next/og';
import { ogFonts } from './ogFont';

// 로고의 파란 말풍선 'On' 아이콘 (탭 아이콘·홈 화면 아이콘 공용)
export async function renderIcon(px: number) {
  const fonts = await ogFonts('On', [800]);
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%',
          borderRadius: `${px / 2}px ${px / 2}px ${px / 2}px ${px / 8}px`,
          background: 'linear-gradient(135deg, #3a86f0 0%, #1559c4 100%)',
          color: '#fff', fontFamily: 'Noto Sans KR', fontWeight: 800, fontSize: px * 0.44, letterSpacing: -px * 0.02,
          paddingBottom: px * 0.04,
        }}
      >
        On
      </div>
    ),
    { width: px, height: px, fonts },
  );
}
