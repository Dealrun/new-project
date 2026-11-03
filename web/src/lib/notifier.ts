// 알림 발송: 군 메일 + 군 알림톡. 연동 정보가 없으면 테스트 모드로 기록만 남긴다.
import type { Row } from './db';

export const DEFAULT_TEMPLATES: Record<string, string> = {
  reminder: '[국방부] {name}님, 내일 {date} {duty} 근무입니다.',
  change: '[국방부] {name}님, 근무가 변경되었습니다. {detail}',
  swap_request: '[국방부] {name}님, 교대 요청이 도착했습니다. {detail}',
  swap_done: '[국방부] {name}님, 교대가 성립되었습니다. {detail}',
  draw: '[국방부] {name}님, 차출 인원으로 선발되었습니다. {detail}',
  confirm: '[국방부] {name}님, {date} 근무표가 확정되었습니다. {detail}',
};
export const TEMPLATE_LABELS: Record<string, string> = {
  reminder: '전날 17:00 알림', change: '근무 변경(재편성·수동 수정)', swap_request: '교대 요청 도착',
  swap_done: '교대 성립', draw: '차출 선발', confirm: '근무표 확정',
};
export const CHANNELS: Record<string, string> = { mail: '군 메일', alimtalk: '알림톡' };

export function renderTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

export function channelStatus() {
  return { mail: process.env.MAIL_ENABLED === 'true', alimtalk: process.env.ALIMTALK_ENABLED === 'true' };
}

export interface Delivery { result: 'success' | 'fail'; error: string | null; note: string | null }

// 연동 정보가 없으면 발송 기록만 남긴다(화면에는 별도 표시하지 않음)
const TEST_NOTE = null;

// 메일·알림톡 체계 연동 규격(X2·X3) 수신 전 임시 어댑터: JSON POST. 규격에 맞게 이 함수만 바꾸면 된다.
async function post(endpoint: string | undefined, to: string, message: string) {
  if (!endpoint) throw new Error('연동 주소 미설정');
  const r = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, message }), signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`연동 서버 응답 ${r.status}`);
}

export async function deliver(person: Row | null, channel: string, content: string): Promise<Delivery> {
  const st = channelStatus();
  try {
    if (!person) throw new Error('대상자 없음');
    if (channel === 'mail') {
      if (!person.email) throw new Error('군 메일 주소 미등록');
      if (!st.mail) return { result: 'success', error: null, note: TEST_NOTE };
      await post(process.env.MAIL_ENDPOINT, person.email, content);
    } else {
      if (!person.phone) throw new Error('휴대폰 번호 미등록');
      if (!st.alimtalk) return { result: 'success', error: null, note: TEST_NOTE };
      await post(process.env.ALIMTALK_ENDPOINT, person.phone, content);
    }
    return { result: 'success', error: null, note: null };
  } catch (e) {
    return { result: 'fail', error: (e as Error).message, note: null };
  }
}
