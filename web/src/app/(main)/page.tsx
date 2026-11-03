'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApp } from '@/components/AppContext';
import { SlotRef, SwapModal } from '@/components/SlotModals';
import { Empty, PageHero, SectionTitle, SwapBadge, Tag } from '@/components/ui';
import { Any, SHORT, api, dday, fmtDate, fmtLong, monthLabel, run, slotLabel, toast, useApi } from '@/lib/client';

export default function HomePage() {
  const { me } = useApp();
  const [d, reload] = useApi<Any>('/home');
  const [swapSlot, setSwapSlot] = useState<SlotRef | null>(null);
  if (!d) return <div className="loading">불러오는 중…</div>;

  const order = ['dangjik', 'iljik', 'bisang'];
  const todayRows: Any[] = [...d.today_slots].sort((a, b) => order.indexOf(a.duty) - order.indexOf(b.duty));
  const a = d.admin;

  const act = (id: number, action: string) => run(async () => {
    if (action === 'accept' && !confirm('교대를 수락하면 근무표가 바로 바뀝니다. 수락할까요?')) return;
    await api(`/swaps/${id}/${action}`, { method: 'POST' });
    toast({ accept: '교대가 성립되어 근무표에 반영했습니다.', reject: '요청을 거절했습니다.', cancel: '요청을 취소했습니다.' }[action]!);
    reload();
  });

  return (
    <>
      <PageHero
        eyebrow="My Duty"
        title={d.next
          ? <span className="next-duty"><span className="big">{fmtLong(d.next.date)}<br /><span className="duty-name">{slotLabel(d.next.duty, d.next.dept)}</span></span></span>
          : <>{me.rank} {me.name}님,<br />예정된 근무가 없습니다.</>}
        desc={d.next
          ? <><span className="chip">{dday(d.next.date, d.today)}</span>&nbsp; {me.rank} {me.name}님의 다음 근무입니다.</>
          : me.is_admin && !me.duties.length ? '근무 대상이 아닌 편성 담당 계정입니다.' : '확정된 근무표에 예정된 근무가 없습니다.'}
      >
        <div className="card glass">
          <SectionTitle eyebrow="Today" title="오늘 근무자" sub={fmtDate(d.today)} />
          {todayRows.length ? (
            <ul className="list today-list">
              {todayRows.map((s) => (
                <li key={s.duty + s.dept}>
                  <Tag duty={s.duty} />
                  <span>{s.duty === 'bisang' && <span className="muted">{s.dept} </span>}<b>{s.name || '미배정'}</b></span>
                  {s.mine && <span className="badge warn">나</span>}
                </li>
              ))}
            </ul>
          ) : <Empty>오늘 날짜의 확정된 근무표가 없습니다.</Empty>}
        </div>
      </PageHero>

      <div className="container page">
        {a && (
          <div className="kpis" style={{ marginBottom: 20 }}>
            <Link href="/admin" className="kpi"><b>{a.drafts.length ? a.drafts.map(monthLabel).join(', ') : '없음'}</b><span>확정 대기 초안</span></Link>
            <Link href="/notify" className={'kpi' + (a.failed ? ' alertish' : '')}><b>{a.failed}건</b><span>알림 발송 실패</span></Link>
            <div className="kpi"><b>{a.makeup}명</b><span>보충 대기열</span></div>
            <div className="kpi"><b>{a.pending_swaps}건</b><span>처리 대기 교대</span></div>
          </div>
        )}

        {d.upcoming.length > 1 && (
          <div className="card">
            <SectionTitle eyebrow="Upcoming" title="이후 근무" />
            <div className="row">{d.upcoming.slice(1, 8).map((r: Any) => <span key={r.date + r.duty} className="badge blue">{fmtDate(r.date)} {SHORT[r.duty]}</span>)}</div>
            {d.unavail.length > 0 && <div className="hint">등록된 휴가·출장: {d.unavail.map((u: Any) => `${u.kind} ${fmtDate(u.start_date)}~${fmtDate(u.end_date)}`).join(', ')}</div>}
          </div>
        )}

        <div className="card">
          <SectionTitle eyebrow="Requests" title="받은 교대 요청" />
          {d.incoming.length ? (
            <ul className="list">
              {d.incoming.map((s: Any) => (
                <li key={s.id}>
                  <Tag duty={s.duty} />
                  <span><b>{s.requester_name}</b>님이 <b>{fmtDate(s.date)} {s.label}</b> 근무를 대신 서 달라고 요청
                    {s.target_date && <> · 대신 귀하의 <b>{fmtDate(s.target_date)}</b> 근무를 맡음(맞교대)</>}
                    {s.memo && <span className="muted"> “{s.memo}”</span>}</span>
                  <span className="spacer" />
                  <button className="btn primary sm" onClick={() => act(s.id, 'accept')}>수락</button>
                  <button className="btn danger sm" onClick={() => act(s.id, 'reject')}>거절</button>
                </li>
              ))}
            </ul>
          ) : <Empty>받은 교대 요청이 없습니다.</Empty>}
        </div>

        <div className="grid2">
          <div className="card">
            <SectionTitle eyebrow="This Month" title="이번 달 내 근무" sub={monthLabel(d.today.slice(0, 7))} />
            {d.month_list.length ? (
              <ul className="list">
                {d.month_list.map((r: Any) => (
                  <li key={r.date + r.duty} className={r.date < d.today ? 'past' : ''}>
                    <Tag duty={r.duty} /><span>{fmtDate(r.date)} {slotLabel(r.duty, r.dept)}</span>
                    <span className="spacer" />
                    {r.date >= d.today ? <button className="btn sm" onClick={() => setSwapSlot(r)}>교대 요청</button> : <span className="small">지남</span>}
                  </li>
                ))}
              </ul>
            ) : <Empty>이번 달 근무가 없습니다.</Empty>}
          </div>
          <div className="card">
            <SectionTitle eyebrow="Sent" title="보낸 교대 요청" />
            {d.outgoing.length ? (
              <ul className="list">
                {d.outgoing.map((s: Any) => (
                  <li key={s.id}>
                    <SwapBadge status={s.status} />
                    <span>{fmtDate(s.date)} {s.label} → <b>{s.target_name}</b>{s.target_date && ` (맞교대 ${fmtDate(s.target_date)})`}</span>
                    {s.status === 'pending' && <><span className="spacer" /><button className="btn sm" onClick={() => act(s.id, 'cancel')}>취소</button></>}
                  </li>
                ))}
              </ul>
            ) : <Empty>보낸 교대 요청이 없습니다.</Empty>}
          </div>
        </div>
      </div>
      {swapSlot && <SwapModal slot={swapSlot} onClose={() => setSwapSlot(null)} onDone={reload} />}
    </>
  );
}
