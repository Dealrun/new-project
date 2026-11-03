'use client';
import { useState } from 'react';
import { useApp } from '@/components/AppContext';
import { EditCellModal, SlotRef, SwapModal } from '@/components/SlotModals';
import { PageHero, StatusBadge } from '@/components/ui';
import { Any, S, SHORT, WD, monthAdd, monthLabel, slotLabel, useApi } from '@/lib/client';

export default function CalendarPage() {
  const { me, meta } = useApp();
  const [month, setMonthState] = useState(S.month);
  const [f, setF] = useState({ duty: S.duty, dept: S.dept, mine: S.mineOnly });
  const [d, reload] = useApi<Any>('/schedule?month=' + month);
  const [modal, setModal] = useState<{ kind: 'swap' | 'edit'; slot: SlotRef } | null>(null);

  const setMonth = (m: string) => { S.month = m; setMonthState(m); };
  const setFilter = (k: 'duty' | 'dept' | 'mine', v: string | boolean) => {
    const next = { ...f, [k]: v };
    S.duty = next.duty; S.dept = next.dept; S.mineOnly = next.mine;
    setF(next);
  };

  const canEdit = !!me.is_admin;
  const confirmed = d?.status === 'confirmed';
  const pending = new Set<string>((d?.pending_swaps || []).map((p: Any) => `${p.date}|${p.duty}|${p.dept}`));
  const show = (s: Any) => (f.duty === 'all' || s.duty === f.duty) && (s.duty !== 'bisang' || f.dept === 'all' || s.dept === f.dept) && (!f.mine || s.mine);

  const onSlot = (s: Any) => {
    const mineSwappable = s.mine && confirmed && s.date >= meta.today;
    if (mineSwappable && (!canEdit || confirm('내 근무입니다. 교대 요청을 보낼까요?\n(취소를 누르면 간부 수정 화면으로 갑니다)'))) {
      return setModal({ kind: 'swap', slot: s });
    }
    if (canEdit) setModal({ kind: 'edit', slot: s });
  };

  const first = new Date(month + '-01T00:00:00').getDay();

  return (
    <>
      <PageHero eyebrow="Calendar" title="월간 근무표" desc="평일과 주말·공휴일은 순번을 따로 돌립니다. 노란 칸이 내 근무입니다." />
      <div className="container page">
        <div className="card">
          <div className="cal-head">
            <button className="btn" onClick={() => setMonth(monthAdd(month, -1))} aria-label="이전 달">◀</button>
            <h2>{monthLabel(month)}</h2>
            <button className="btn" onClick={() => setMonth(monthAdd(month, 1))} aria-label="다음 달">▶</button>
            <button className="btn sm ghost" onClick={() => setMonth(meta.today.slice(0, 7))}>이번 달</button>
            {d && <StatusBadge status={d.status} />}
            <span className="spacer" />
            <select value={f.duty} onChange={(e) => setFilter('duty', e.target.value)}>
              <option value="all">근무 전체</option><option value="dangjik">당직사관</option><option value="iljik">일직사관</option><option value="bisang">비상대기</option>
            </select>
            <select value={f.dept} onChange={(e) => setFilter('dept', e.target.value)}>
              <option value="all">부서 전체</option>{meta.depts.map((x: string) => <option key={x} value={x}>{x}</option>)}
            </select>
            <label className="row small"><input type="checkbox" checked={f.mine} onChange={(e) => setFilter('mine', e.target.checked)} />내 근무만</label>
          </div>

          {!d ? <div className="loading">불러오는 중…</div> : (
            <>
              {d.status === 'draft' && canEdit && <div className="alert warn">초안입니다. 근무자에게는 아직 보이지 않습니다. 칸을 눌러 수정한 뒤 [편성 관리]에서 확정하세요.</div>}
              {!d.visible && <div className="alert warn">{monthLabel(month)} 근무표가 아직 {d.status === 'draft' ? '확정되지 않았습니다' : '편성되지 않았습니다'}.</div>}
              {d.visible && (
                <>
                  <div className="cal">
                    {WD.map((w, i) => <div key={w} className={'dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')}>{w}</div>)}
                    {Array.from({ length: first }, (_, i) => <div key={'b' + i} className="day blank" />)}
                    {d.days.map((day: Any) => {
                      const dt = new Date(day.date + 'T00:00:00');
                      const cls = ['day', day.daytype === 'weekend' && 'weekend', day.date === meta.today && 'today'].filter(Boolean).join(' ');
                      return (
                        <div key={day.date} className={cls}>
                          <div className="dnum">{dt.getDate()}<span className="dow-m">({WD[dt.getDay()]})</span>{day.holiday && <span className="hname">{day.holiday}</span>}</div>
                          {day.slots.filter(show).map((s: Any) => {
                            const clickable = canEdit || (s.mine && confirmed && day.date >= meta.today);
                            const cl = ['slot', s.mine && 'mine', clickable && 'clickable', !s.person_id && 'empty-slot', pending.has(`${s.date}|${s.duty}|${s.dept}`) && 'pending'].filter(Boolean).join(' ');
                            return (
                              <button key={s.duty + s.dept} className={cl} title={`${slotLabel(s.duty, s.dept)} ${s.name || '미배정'}`}
                                onClick={clickable ? () => onSlot(s) : undefined}>
                                <span className={'k ' + s.duty}>{s.duty === 'bisang' ? s.dept.slice(0, 2) : SHORT[s.duty]}</span>{s.name || '미배정'}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                  <div className="legend">
                    <span><i style={{ background: 'var(--weekend-bg)' }} />주말·공휴일 (별도 순번)</span>
                    <span><i style={{ background: 'var(--mine)', borderColor: 'var(--mine-line)' }} />내 근무{confirmed && ' (눌러서 교대 요청)'}</span>
                    <span>⇄ 교대 요청 처리 중</span>
                    {canEdit && <span>간부: 칸을 눌러 수동 수정</span>}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {modal?.kind === 'swap' && <SwapModal slot={modal.slot} onClose={() => setModal(null)} onDone={reload} />}
      {modal?.kind === 'edit' && <EditCellModal slot={modal.slot} onClose={() => setModal(null)} onDone={reload} />}
    </>
  );
}
