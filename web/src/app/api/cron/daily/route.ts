import { NextRequest, NextResponse } from 'next/server';
import { runCron } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Vercel Cron이 매일 08:00 UTC(= 17:00 KST)에 호출한다. vercel.json 참고.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const ok = secret ? req.headers.get('authorization') === `Bearer ${secret}` : process.env.NODE_ENV !== 'production';
  if (!ok) return NextResponse.json({ error: '권한 없음' }, { status: 401 });
  return NextResponse.json(await runCron());
}
