import { NextRequest, NextResponse } from 'next/server';
import { handleApi } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const body = req.method === 'GET' ? {} : await req.json().catch(() => ({}));
  const r = await handleApi(req.method, '/' + path.join('/'), req.nextUrl.searchParams, body, req.cookies.get('sid')?.value);
  const res = NextResponse.json(r.payload, { status: r.status, headers: { 'Cache-Control': 'no-store' } });
  for (const c of r.cookies) {
    res.cookies.set(c.name, c.value, {
      httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: c.maxAge,
    });
  }
  return res;
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
