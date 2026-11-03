// 서버·화면 공용: 날짜(한국 시간 기준)와 오류 타입

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];

function kstParts() {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date())) p[x.type] = x.value;
  return p;
}

export function today() {
  const p = kstParts();
  return `${p.year}-${p.month}-${p.day}`;
}

export function now() {
  const p = kstParts();
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function nowHM(): [number, number] {
  const p = kstParts();
  return [Number(p.hour), Number(p.minute)];
}

export function parseDate(s: unknown): Date {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ApiError(400, `날짜 형식이 올바르지 않습니다: ${s}`);
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new ApiError(400, `없는 날짜입니다: ${s}`);
  return d;
}

export function addDays(s: string, n: number) {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekday(s: string) {
  return parseDate(s).getUTCDay(); // 0=일 ... 6=토
}

export function fmtDate(s: string) {
  const d = parseDate(s);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${WD[d.getUTCDay()]})`;
}

export function monthDates(month: string) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw new ApiError(400, `월 형식이 올바르지 않습니다: ${month}`);
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}
