import { ImageResponse } from 'next/og';
import { ogFonts } from '@/lib/ogFont';

// 링크 공유(카카오톡·메신저 등) 미리보기 썸네일
export const alt = 'OnDuty - 근무표는 자동으로, 변동은 즉시';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const C = {
  text: '#17202c', sub: '#3d4756', muted: '#7a8494', line: '#e7ecf2',
  primary: '#1f6fe5', primaryWeak: '#eaf2fe', weekend: '#e0464c', mine: '#fff3c6', mineLine: '#efc13a',
  dangjik: '#1f6fe5', iljik: '#7b5cf0', bisang: '#10a17c', chachul: '#c27a1a',
};

const DUTIES = [
  { label: '당직사관', color: C.dangjik },
  { label: '일직사관', color: C.iljik },
  { label: '비상대기', color: C.bisang },
  { label: '차출', color: C.chachul },
];

// 미니 달력: 5주 × 7일, 칸마다 근무 색 막대
const WEEKS = 5;
const cellDuties = (i: number) => [i % 3 === 0 ? 0 : 1, (i * 5 + 2) % 4 === 3 ? 3 : 2];
const MY_CELL = 17;

const HEADLINE = ['근무표는 자동으로,', '변동은 즉시.'];
const SUB = '당직 · 일직 · 비상대기 · 차출 순번 편성과 전날 알림';
const TOAST = '[국방부] 김하늘님, 내일 11/18 당직사관 근무입니다.';
const CAL_TITLE = '11월 근무표';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const BADGE = '확정';

export default async function Image() {
  const fonts = await ogFonts(
    ['OnDuty', ...HEADLINE, SUB, TOAST, CAL_TITLE, BADGE, ...WEEKDAYS, ...DUTIES.map((d) => d.label), '0123456789'].join(''),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(115deg, #f7faff 0%, #e4eefb 48%, #c3d9f2 100%)',
          fontFamily: 'Noto Sans KR', color: C.text,
        }}
      >
        {/* 배경 원형 장식 */}
        <div style={{ position: 'absolute', right: -160, top: -200, width: 620, height: 620, borderRadius: 620, background: 'rgba(31,111,229,.10)' }} />
        <div style={{ position: 'absolute', right: 260, bottom: -260, width: 460, height: 460, borderRadius: 460, background: 'rgba(255,255,255,.55)' }} />

        {/* 왼쪽: 로고 · 문구 */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 0 0 76px', width: 640 }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 64, fontWeight: 800, letterSpacing: -3 }}>
            On
            <div
              style={{
                display: 'flex', marginLeft: 8, background: C.primary, color: '#fff', fontSize: 46,
                padding: '4px 22px 8px', borderRadius: '999px 999px 999px 10px', letterSpacing: -1,
              }}
            >
              Duty
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 40, fontSize: 60, fontWeight: 800, lineHeight: 1.22, letterSpacing: -2.5 }}>
            <div style={{ display: 'flex' }}>{HEADLINE[0]}</div>
            <div style={{ display: 'flex', color: C.primary }}>{HEADLINE[1]}</div>
          </div>

          <div style={{ display: 'flex', marginTop: 26, fontSize: 25, fontWeight: 500, color: C.sub, letterSpacing: -0.5 }}>{SUB}</div>

          <div style={{ display: 'flex', marginTop: 34 }}>
            {DUTIES.map((d) => (
              <div
                key={d.label}
                style={{
                  display: 'flex', alignItems: 'center', marginRight: 12, padding: '9px 18px', borderRadius: 999,
                  background: '#fff', fontSize: 21, fontWeight: 500, color: C.sub, boxShadow: '0 4px 14px rgba(31,64,120,.08)',
                }}
              >
                <div style={{ width: 12, height: 12, borderRadius: 12, background: d.color, marginRight: 9 }} />
                {d.label}
              </div>
            ))}
          </div>
        </div>

        {/* 오른쪽: 달력 카드 + 알림 */}
        <div style={{ display: 'flex', position: 'absolute', left: 720, top: 92 }}>
          <div
            style={{
              display: 'flex', flexDirection: 'column', width: 410, padding: '26px 26px 22px', borderRadius: 28,
              background: '#fff', boxShadow: '0 30px 70px rgba(31,64,120,.18)', transform: 'rotate(-3deg)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', fontSize: 26, fontWeight: 800, letterSpacing: -1 }}>{CAL_TITLE}</div>
              <div style={{ display: 'flex', fontSize: 17, fontWeight: 800, color: '#0f8a5f', background: '#e5f6ee', padding: '4px 13px', borderRadius: 999 }}>{BADGE}</div>
            </div>
            <div style={{ display: 'flex', marginBottom: 8 }}>
              {WEEKDAYS.map((w, i) => (
                <div key={w} style={{ display: 'flex', justifyContent: 'center', width: 51, fontSize: 15, fontWeight: 500, color: i === 0 || i === 6 ? C.weekend : C.muted }}>{w}</div>
              ))}
            </div>
            {Array.from({ length: WEEKS }, (_, w) => (
              <div key={w} style={{ display: 'flex', marginBottom: 6 }}>
                {Array.from({ length: 7 }, (_, d) => {
                  const i = w * 7 + d;
                  const mine = i === MY_CELL;
                  return (
                    <div
                      key={d}
                      style={{
                        display: 'flex', flexDirection: 'column', width: 46, height: 46, marginRight: 5, padding: '5px 6px', borderRadius: 10,
                        background: mine ? C.mine : d === 0 || d === 6 ? '#fff7f7' : '#f6f8fb',
                        border: mine ? `2px solid ${C.mineLine}` : `1px solid ${C.line}`,
                      }}
                    >
                      <div style={{ display: 'flex', fontSize: 12, fontWeight: 500, color: d === 0 || d === 6 ? C.weekend : C.muted }}>{i + 1 <= 30 ? i + 1 : ''}</div>
                      {i < 30 && cellDuties(i).map((k, j) => (
                        <div key={j} style={{ height: 5, borderRadius: 5, marginTop: 3, background: DUTIES[k].color, opacity: 0.85 }} />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* 알림 말풍선 */}
        <div
          style={{
            display: 'flex', alignItems: 'center', position: 'absolute', left: 640, bottom: 54, padding: '16px 24px 16px 16px',
            borderRadius: 20, background: 'rgba(23,32,44,.92)', color: '#fff', boxShadow: '0 18px 40px rgba(16,24,40,.25)',
          }}
        >
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, marginRight: 14,
              borderRadius: '20px 20px 20px 6px', background: C.primary, fontSize: 17, fontWeight: 800,
            }}
          >
            On
          </div>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 500, letterSpacing: -0.4 }}>{TOAST}</div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
