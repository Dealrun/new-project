import { ImageResponse } from 'next/og';
import { ogFonts } from '@/lib/ogFont';

// OnDuty 대표 이미지(썸네일) 그림. 가로 1200 고정, 높이를 늘리면 위아래 여백이 생겨 16:10 같은 비율에서도 잘리지 않는다 — 올리브 군복 톤, 근무 명령서, 인식표 알림
const W = 1200;
const BASE_H = 630;

const C = {
  olive: '#26301d', oliveMid: '#3b4a2a', khaki: '#c8b98a', sand: '#e6dcb8', paper: '#f1ecda',
  ink: '#2a2a22', inkSub: '#5b5a4c', brass: '#e0b84a', stamp: '#b3322c', rule: '#d9d0b4',
};

const DUTIES = [
  { label: '당직사관', color: '#d1a640' },
  { label: '일직사관', color: '#9db06e' },
  { label: '비상대기', color: '#c2463c' },
  { label: '차출', color: '#b98a5a' },
];

// 근무 명령서 행 (가상 인원)
const ROWS = [
  { date: '11.17 (화)', duty: 0, name: '대위 정민수' },
  { date: '11.18 (수)', duty: 0, name: '중위 김하늘', mine: true },
  { date: '11.19 (목)', duty: 1, name: '소위 박서진' },
  { date: '11.20 (금)', duty: 2, name: '상사 이도윤' },
  { date: '11.21 (토)', duty: 3, name: '병장 최우진', weekend: true },
];

const LABEL = 'REPUBLIC OF KOREA · DUTY ROSTER';
const HEADLINE = ['근무표는 자동으로,', '변동은 즉시.'];
const SUB = '당직 · 일직 · 비상대기 · 차출 순번 편성과 전날 알림';
const DOC_TITLE = '근무 편성표';
const DOC_META = ['2026년 11월', '제 1 대대'];
const STAMP = ['확정', '편성담당'];
const TAG = '[국방부] 김하늘님, 내일 11/18 당직사관 근무입니다.';

// 위장 무늬 얼룩: [left, top, width, height, color, rotate]
const CAMO: [number, number, number, number, string, number][] = [
  [-80, -60, 360, 200, '#33402a', -18], [180, 420, 420, 190, '#1f2818', 12], [420, -90, 300, 170, '#2e3a22', 24],
  [-60, 330, 260, 160, '#3a4630', -30], [560, 230, 280, 150, '#202a19', -8], [960, -40, 340, 190, '#33402a', 16],
  [880, 470, 380, 200, '#1f2818', -14], [330, 210, 220, 120, '#34412a', 38],
];

const HAZARD = `repeating-linear-gradient(45deg, ${C.brass} 0px, ${C.brass} 18px, ${C.olive} 18px, ${C.olive} 36px)`;

const Star =({ s = 20, fill = C.brass }: { s?: number; fill?: string }) => (
  <svg width={s} height={s} viewBox="0 0 24 24">
    <path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.6 7-6.2-3.8-6.2 3.8 1.6-7L2 9.5l7.1-.6z" fill={fill} />
  </svg>
);

// scale: 같은 그림을 더 큰 해상도로 뽑을 때 배율
export async function renderThumbnail(height = BASE_H, scale = 1) {
  const dy = (height - BASE_H) / 2;
  const korean = [...HEADLINE, SUB, DOC_TITLE, ...DOC_META, ...STAMP, TAG, ...DUTIES.map((d) => d.label),
    ...ROWS.flatMap((r) => [r.date, r.name]), LABEL, '0123456789 일시 근무 근무자'].join('');
  const [kr, stencil] = await Promise.all([
    ogFonts(korean),
    ogFonts('ONDUTY', [400], 'Black Ops One'),
  ]);

  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <div
        style={{
          width: W, height, flexShrink: 0, display: 'flex', position: 'relative', overflow: 'hidden',
          transform: `scale(${scale})`, transformOrigin: 'top left',
          background: `linear-gradient(125deg, ${C.oliveMid} 0%, ${C.olive} 55%, #1a2114 100%)`,
          fontFamily: 'Noto Sans KR', color: C.paper,
        }}
      >
        {/* 위장 무늬 */}
        {CAMO.map(([l, t, w, h, c, r], i) => (
          <div key={i} style={{ position: 'absolute', left: l, top: t, width: w, height: h, borderRadius: '50%', background: c, opacity: 0.7, transform: `rotate(${r}deg)` }} />
        ))}
        {/* 작전 지도 격자 */}
        {Array.from({ length: 20 }, (_, i) => (
          <div key={`v${i}`} style={{ position: 'absolute', left: i * 60, top: 0, width: 1, height, background: 'rgba(230,220,184,.06)' }} />
        ))}
        {Array.from({ length: Math.ceil(height / 60) + 1 }, (_, i) => (
          <div key={`h${i}`} style={{ position: 'absolute', left: 0, top: i * 60, width: 1200, height: 1, background: 'rgba(230,220,184,.06)' }} />
        ))}
        {/* 위아래 경계 띠 */}
        <div style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 10, background: HAZARD, opacity: 0.9 }} />
        <div style={{ position: 'absolute', left: 0, bottom: 0, width: 1200, height: 10, background: HAZARD, opacity: 0.9 }} />

        {/* 왼쪽: 표지 문구 */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 0 0 72px', width: 640 }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 17, fontWeight: 800, letterSpacing: 4, color: C.khaki }}>
            <Star s={20} />
            <div style={{ display: 'flex', marginLeft: 10 }}>{LABEL}</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 14, fontFamily: 'Black Ops One', fontSize: 104, lineHeight: 1, letterSpacing: 2 }}>
            <div style={{ display: 'flex', color: C.sand }}>ON</div>
            <div style={{ display: 'flex', marginLeft: 24, color: C.brass }}>DUTY</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 34, fontSize: 52, fontWeight: 800, lineHeight: 1.25, letterSpacing: -2 }}>
            <div style={{ display: 'flex' }}>{HEADLINE[0]}</div>
            <div style={{ display: 'flex', color: C.brass }}>{HEADLINE[1]}</div>
          </div>

          <div style={{ display: 'flex', marginTop: 20, fontSize: 23, fontWeight: 500, color: C.khaki, letterSpacing: -0.4 }}>{SUB}</div>

          <div style={{ display: 'flex', marginTop: 30 }}>
            {DUTIES.map((d) => (
              <div
                key={d.label}
                style={{
                  display: 'flex', alignItems: 'center', marginRight: 10, padding: '8px 16px', borderRadius: 6,
                  background: 'rgba(20,26,15,.55)', border: `1.5px solid rgba(200,185,138,.45)`, fontSize: 19, fontWeight: 500, color: C.sand,
                }}
              >
                <div style={{ width: 11, height: 11, background: d.color, marginRight: 9, transform: 'rotate(45deg)' }} />
                {d.label}
              </div>
            ))}
          </div>
        </div>

        {/* 오른쪽: 근무 명령서 */}
        <div
          style={{
            display: 'flex', flexDirection: 'column', position: 'absolute', left: 712, top: 60 + dy, width: 430,
            background: C.paper, color: C.ink, borderRadius: 6, transform: 'rotate(2.5deg)',
            boxShadow: '0 30px 60px rgba(0,0,0,.45)',
          }}
        >
          {/* 클립 */}
          <div style={{ position: 'absolute', left: 175, top: -16, width: 80, height: 30, borderRadius: 6, background: 'linear-gradient(180deg,#a9aea4,#6f756b)', border: '2px solid #5b6157' }} />
          <div style={{ display: 'flex', flexDirection: 'column', padding: '30px 28px 26px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 12, borderBottom: `3px solid ${C.ink}` }}>
              <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, letterSpacing: 2 }}>{DOC_TITLE}</div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: 15, fontWeight: 500, color: C.inkSub }}>
                <div style={{ display: 'flex' }}>{DOC_META[0]}</div>
                <div style={{ display: 'flex' }}>{DOC_META[1]}</div>
              </div>
            </div>
            <div style={{ display: 'flex', padding: '10px 4px 6px', fontSize: 14, fontWeight: 800, color: C.inkSub, letterSpacing: 2 }}>
              <div style={{ display: 'flex', width: 118 }}>일시</div>
              <div style={{ display: 'flex', width: 132 }}>근무</div>
              <div style={{ display: 'flex' }}>근무자</div>
            </div>
            {ROWS.map((r) => (
              <div
                key={r.date + r.name}
                style={{
                  display: 'flex', alignItems: 'center', height: 50, padding: '0 4px', borderTop: `1px solid ${C.rule}`,
                  background: r.mine ? 'rgba(224,184,74,.32)' : 'transparent', fontSize: 19,
                }}
              >
                <div style={{ display: 'flex', width: 118, fontWeight: 500, color: r.weekend ? C.stamp : C.ink }}>{r.date}</div>
                <div style={{ display: 'flex', alignItems: 'center', width: 132, fontWeight: 500 }}>
                  <div style={{ width: 10, height: 10, background: DUTIES[r.duty].color, marginRight: 8, transform: 'rotate(45deg)' }} />
                  {DUTIES[r.duty].label}
                </div>
                <div style={{ display: 'flex', fontWeight: 800 }}>{r.name}</div>
              </div>
            ))}
          </div>
          {/* 확정 직인 */}
          <div
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'absolute', right: 128, top: 12,
              width: 92, height: 92, borderRadius: 92, border: `4px solid ${C.stamp}`, color: C.stamp, transform: 'rotate(-16deg)', opacity: 0.82,
            }}
          >
            <div style={{ display: 'flex', fontSize: 27, fontWeight: 800, letterSpacing: 3, lineHeight: 1.1 }}>{STAMP[0]}</div>
            <div style={{ display: 'flex', fontSize: 13, fontWeight: 800, letterSpacing: 0.5, marginTop: 3 }}>{STAMP[1]}</div>
          </div>
        </div>

        {/* 인식표 알림 */}
        <div
          style={{
            display: 'flex', alignItems: 'center', position: 'absolute', left: 612, bottom: 42 + dy, height: 74, padding: '0 28px 0 18px',
            borderRadius: 24, background: 'linear-gradient(180deg, #e4e7e1 0%, #b7bcb3 55%, #9aa096 100%)',
            border: '2px solid #6f756b', color: '#1e2617', transform: 'rotate(-2deg)', boxShadow: '0 16px 36px rgba(0,0,0,.45)',
          }}
        >
          <div style={{ width: 22, height: 22, borderRadius: 22, background: C.olive, border: '3px solid #7d837a', marginRight: 16 }} />
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 800, letterSpacing: -0.3 }}>{TAG}</div>
        </div>
      </div>
      </div>
    ),
    { width: W * scale, height: height * scale, fonts: [...kr, ...stencil] },
  );
}
