'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { AppCtx } from '@/components/AppContext';
import { Logo } from '@/components/Logo';
import { Any, S, api, monthAdd, run } from '@/lib/client';

export default function MainLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState<{ me: Any; meta: Any } | null>(null);

  const reloadMe = useCallback(async () => {
    try {
      const r = await api('/me');
      S.month ||= r.meta.today.slice(0, 7);
      S.planMonth ||= monthAdd(r.meta.today.slice(0, 7), 1);
      setState({ me: r.user, meta: r.meta });
    } catch {
      router.replace('/login');
    }
  }, [router]);
  useEffect(() => { reloadMe(); }, [reloadMe]);

  const adminOnly = path.startsWith('/admin') || path.startsWith('/notify');
  useEffect(() => {
    if (state && adminOnly && !state.me.is_admin) router.replace('/');
  }, [state, adminOnly, router]);

  if (!state) return <div className="loading">불러오는 중…</div>;
  const { me, meta } = state;
  const links: [string, string][] = [['/', '오늘 · 내 근무'], ['/calendar', '월간 근무표']];
  if (me.is_admin) links.push(['/admin', '편성 관리'], ['/notify', '알림 관리']);

  return (
    <AppCtx.Provider value={{ me, meta, reloadMe }}>
      <header className="topbar">
        <div className="container topbar-inner">
          <Link href="/" className="brand"><Logo /></Link>
          <nav className="nav">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className={(href === '/' ? path === '/' : path.startsWith(href)) ? 'active' : ''}>{label}</Link>
            ))}
          </nav>
          <div className="userbox">
            <span className="who">{me.rank} {me.name}</span>
            <span className="role">{me.is_admin ? '간부' : '근무자'}</span>
            <button className="btn ghost sm" onClick={() => run(async () => { await api('/auth/logout', { method: 'POST' }); router.replace('/login'); })}>로그아웃</button>
          </div>
        </div>
      </header>
      <main>{(!adminOnly || me.is_admin) && children}</main>
      <footer className="footer"><div className="container">OnDuty</div></footer>
    </AppCtx.Provider>
  );
}
