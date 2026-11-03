import { ImageResponse } from 'next/og';
import { ogFonts } from './ogFont';

// 올리브 바탕에 황동 테두리·별, 스텐실 'ON' 아이콘 (탭 아이콘·홈 화면 아이콘 공용)
export async function renderIcon(px: number) {
  const fonts = await ogFonts('ON', [400], 'Black Ops One');
  const star = px * 0.2;
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%',
          borderRadius: px * 0.22, background: 'linear-gradient(135deg, #4a5a34 0%, #26301d 100%)',
          border: `${Math.max(2, px * 0.045)}px solid #e0b84a`,
        }}
      >
        <svg width={star} height={star} viewBox="0 0 24 24" style={{ marginBottom: px * 0.01 }}>
          <path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.6 7-6.2-3.8-6.2 3.8 1.6-7L2 9.5l7.1-.6z" fill="#e0b84a" />
        </svg>
        <div style={{ display: 'flex', fontFamily: 'Black Ops One', fontSize: px * 0.4, lineHeight: 1, color: '#e6dcb8' }}>ON</div>
      </div>
    ),
    { width: px, height: px, fonts },
  );
}
