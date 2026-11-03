'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import { Any, api, run } from '@/lib/client';

export default function LoginPage() {
  const router = useRouter();
  const [opt, setOpt] = useState<Any>(null);
  const [pid, setPid] = useState('');

  useEffect(() => {
    run(async () => {
      const o = await api('/auth/options');
      setOpt(o);
      if (o.users?.length) setPid(String(o.users[0].id));
    });
  }, []);

  const users: Any[] = opt?.users || [];
  const label = (u: Any) => `${u.rank} ${u.name} (${u.dept})`;

  return (
    <div className="login">
      <section className="login-hero">
        <Logo size={24} />
        <div className="login-copy">
          <div className="eyebrow">OnDuty</div>
          <h1>근무 편성,<br />이제 자동으로.</h1>
          <p>당직사관 · 일직사관 · 비상대기 · 차출까지<br />순번 규칙대로 채우고, 바뀌면 바로 알려 줍니다.</p>
        </div>
        <ul className="login-points">
          <li><b>평일 / 주말 순번 분리</b><span>주말 근무가 한 사람에게 쏠리지 않게</span></li>
          <li><b>휴가 · 출장 자동 보충</b><span>복귀 후 먼저 배정해 횟수를 맞춤</span></li>
          <li><b>전날 17:00 알림</b><span>군 메일과 알림톡으로 자동 발송</span></li>
        </ul>
        <div className="hero-orb" aria-hidden />
      </section>
      <section className="login-panel">
        <div className="login-box">
          <h2>로그인</h2>
          <p className="muted">본인 계정으로 들어갑니다.</p>
          {opt && opt.dev_login && (
            <>
              <label className="field">계정 선택
                <select value={pid} onChange={(e) => setPid(e.target.value)}>
                  <optgroup label="편성 담당 간부">{users.filter((u) => u.is_admin).map((u) => <option key={u.id} value={u.id}>{label(u)}</option>)}</optgroup>
                  <optgroup label="근무자">{users.filter((u) => !u.is_admin).map((u) => <option key={u.id} value={u.id}>{label(u)}</option>)}</optgroup>
                </select>
              </label>
              <button className="btn primary block lg" onClick={() => run(async () => {
                await api('/auth/dev', { method: 'POST', body: { person_id: Number(pid) } });
                router.replace('/');
              })}>로그인</button>
            </>
          )}
          {opt && !opt.dev_login && <p className="muted">로그인 방식이 설정되지 않았습니다. 관리자에게 문의하세요.</p>}
          {!opt && <p className="muted">불러오는 중…</p>}
        </div>
      </section>
    </div>
  );
}
