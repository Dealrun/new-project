'use client';
// 화면 공용: API 호출, 토스트, 표시용 도우미
import { useCallback, useEffect, useState } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Any = any;

export const DUTY: Record<string, string> = { dangjik: '당직사관', iljik: '일직사관', bisang: '비상대기', chachul: '차출' };
export const SHORT: Record<string, string> = { dangjik: '당직', iljik: '일직', bisang: '비상', chachul: '차출' };
export const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const KIND: Record<string, string> = {
  reminder: '전날 알림', change: '근무 변경', swap_request: '교대 요청', swap_done: '교대 성립', draw: '차출 선발', confirm: '근무표 확정',
};

// 화면 사이를 오가도 유지되는 선택 상태
export const S = { month: '', duty: 'all', dept: 'all', mineOnly: false, adminTab: 'plan', planMonth: '', notifyFilter: '' };

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = Any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/me' && typeof window !== 'undefined') window.location.href = '/login';
  if (!res.ok) throw new HttpError(res.status, data.error || '요청을 처리하지 못했습니다.');
  return data as T;
}

export function toast(msg: string, error = false) {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { msg, error } }));
}

// 비동기 동작 실행: 실패하면 오류 토스트
export async function run(fn: () => Promise<unknown>) {
  try { await fn(); } catch (e) { toast((e as Error).message, true); }
}

export function useApi<T = Any>(path: string | null): [T | null, () => Promise<void>] {
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>(path)); } catch (e) { toast((e as Error).message, true); }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  return [data, load];
}

export function fmtDate(s: string) {
  const d = new Date(s + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}
export function fmtLong(s: string) {
  const d = new Date(s + 'T00:00:00');
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WD[d.getDay()]})`;
}
export const slotLabel = (duty: string, dept?: string) => (duty === 'bisang' && dept ? `${DUTY[duty]}(${dept})` : DUTY[duty]);
export function monthAdd(m: string, n: number) {
  let [y, mo] = m.split('-').map(Number);
  mo += n;
  while (mo > 12) { mo -= 12; y++; }
  while (mo < 1) { mo += 12; y--; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}
export const monthLabel = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
export function dday(date: string, today: string) {
  const diff = Math.round((new Date(date + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000);
  return diff === 0 ? '오늘' : diff === 1 ? '내일' : `D-${diff}`;
}
