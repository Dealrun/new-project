'use client';
// 휴가·출장 / 공휴일 / 차출 뽑기
import { useState } from 'react';
import { useApp } from '@/components/AppContext';
import { Empty, SectionTitle } from '@/components/ui';
import { Any, api, fmtDate, run, toast, useApi } from '@/lib/client';

export function UnavailTab() {
  const { meta } = useApp();
  const [list, reload] = useApi<Any[]>('/unavail');
  const [people] = useApi<Any[]>('/people');
  const [f, setF] = useState({ person_id: '', kind: '휴가', start: meta.today, end: meta.today, memo: '' });
  const [changes, setChanges] = useState<Any[] | null>(null);
  const active = (people || []).filter((p) => p.active && p.duties.length);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v, ...(k === 'start' && x.end < v ? { end: v } : {}) }));

  const add = () => run(async () => {
    const pid = f.person_id || String(active[0]?.id ?? '');
    const r = await api('/unavail', { method: 'POST', body: { ...f, person_id: Number(pid) } });
    toast(r.changes.length ? `등록 완료 · ${r.changes.length}개 칸을 다시 편성했습니다.` : '등록 완료 · 바뀐 근무 칸이 없습니다.');
    setChanges(r.changes);
    reload();
  });
  const del = (id: number) => run(async () => {
    if (!confirm('삭제할까요? 이미 바뀐 근무표는 되돌리지 않습니다.')) return;
    await api('/unavail/' + id, { method: 'DELETE' });
    reload();
  });

  return (
    <>
      <div className="card">
        <SectionTitle eyebrow="Leave" title="휴가·출장 등록" />
        <div className="form-grid">
          <label className="field">인원<select value={f.person_id} onChange={(e) => set('person_id', e.target.value)}>
            {active.map((p) => <option key={p.id} value={p.id}>{p.rank} {p.name} ({p.dept})</option>)}</select></label>
          <label className="field">구분<select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option>휴가</option><option>출장</option></select></label>
          <label className="field">시작일<input type="date" value={f.start} onChange={(e) => set('start', e.target.value)} /></label>
          <label className="field">종료일<input type="date" value={f.end} onChange={(e) => set('end', e.target.value)} /></label>
          <label className="field">메모<input type="text" value={f.memo} onChange={(e) => set('memo', e.target.value)} placeholder="선택" /></label>
          <button className="btn primary" onClick={add}>등록</button>
        </div>
        <div className="hint">이미 편성된 날짜에 걸리면 <b>해당 날짜만</b> 다음 순번으로 다시 편성하고(R6), 빠진 사람은 보충 대기열에 올려 복귀 후 먼저 배정합니다(R3). 바뀐 사람에게는 즉시 알림이 갑니다.</div>
        {changes && changes.length > 0 && (
          <div className="alert ok" style={{ marginTop: 14, marginBottom: 0 }}>
            <b>부분 재편성 결과</b>{changes.map((c, i) => <div key={i}>{c.slot}: {c.before} → <b>{c.after}</b></div>)}
          </div>
        )}
      </div>
      <div className="card">
        <SectionTitle title="등록된 휴가·출장" />
        {list?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>인원</th><th>구분</th><th>기간</th><th>메모</th><th>등록</th><th /></tr></thead>
            <tbody>{list.map((u) => (
              <tr key={u.id}><td>{u.name}</td><td>{u.kind}</td><td>{u.start_date} ~ {u.end_date}</td><td>{u.memo}</td><td className="small muted">{u.created}</td>
                <td><button className="btn sm danger" onClick={() => del(u.id)}>삭제</button></td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>등록된 휴가·출장이 없습니다.</Empty>}
      </div>
    </>
  );
}

export function HolidaysTab() {
  const { meta } = useApp();
  const [list, reload] = useApi<Any[]>('/holidays');
  const [date, setDate] = useState(meta.today);
  const [name, setName] = useState('');
  const add = () => run(async () => {
    const r = await api('/holidays', { method: 'POST', body: { date, name } });
    toast(r.already_planned ? '추가했습니다. 이미 편성된 달이라 기존 배정은 바뀌지 않습니다(초안이면 다시 편성하세요).' : '추가했습니다.');
    setName('');
    reload();
  });
  return (
    <>
      <div className="card">
        <SectionTitle eyebrow="Holiday" title="공휴일 지정" />
        <div className="form-grid">
          <label className="field">날짜<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field">명칭<input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 성탄절" /></label>
          <button className="btn primary" onClick={add}>추가</button>
        </div>
        <div className="hint">공휴일은 주말과 같은 <b>주말·공휴일 순번</b>으로 편성됩니다(R1). 편성 <b>전에</b> 입력하세요.</div>
      </div>
      <div className="card">
        <SectionTitle title="지정된 공휴일" />
        {list?.length ? (
          <ul className="list">{list.map((h) => (
            <li key={h.date}><b>{h.date}</b> {fmtDate(h.date)} {h.name}<span className="spacer" />
              <button className="btn sm danger" onClick={() => run(async () => { await api('/holidays/' + h.date, { method: 'DELETE' }); reload(); })}>해제</button></li>
          ))}</ul>
        ) : <Empty>지정된 공휴일이 없습니다.</Empty>}
      </div>
    </>
  );
}

export function DrawTab() {
  const [list, reload] = useApi<Any[]>('/draws');
  const [count, setCount] = useState('2');
  const [memo, setMemo] = useState('');
  const [result, setResult] = useState<Any | null>(null);
  const go = () => run(async () => {
    if (!confirm(`${count}명을 차출 순번에서 뽑고 알림을 보낼까요?`)) return;
    setResult(await api('/draws', { method: 'POST', body: { count: Number(count), memo } }));
    reload();
  });
  return (
    <>
      <div className="card">
        <SectionTitle eyebrow="Dispatch" title="차출 뽑기" />
        <div className="form-grid">
          <label className="field">필요 인원 수<input type="number" min={1} max={40} value={count} onChange={(e) => setCount(e.target.value)} /></label>
          <label className="field" style={{ gridColumn: 'span 2' }}>사유 메모<input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 연대 작업 지원" /></label>
          <button className="btn primary" onClick={go}>차출 뽑기</button>
        </div>
        <div className="hint">보충 대기열 → 차출 순번 순으로 뽑습니다. 오늘 휴가·출장 중이거나 다른 근무가 있는 인원은 건너뛰고 보충 대기열에 올립니다. 뽑힌 사람에게 즉시 알림이 갑니다.</div>
        {result && <div className="alert ok" style={{ marginTop: 14, marginBottom: 0 }}>선발: <b>{result.chosen.join(', ')}</b>{result.short > 0 && ` (가능 인원 부족으로 ${result.short}명 미선발)`}</div>}
      </div>
      <div className="card">
        <SectionTitle title="차출 기록" />
        {list?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>일시</th><th className="num">요청</th><th>선발 인원</th><th>사유</th><th>처리자</th></tr></thead>
            <tbody>{list.map((r) => <tr key={r.id}><td>{r.created}</td><td className="num">{r.count}명</td><td>{r.names.join(', ')}</td><td>{r.memo}</td><td>{r.actor}</td></tr>)}</tbody>
          </table></div>
        ) : <Empty>차출 기록이 없습니다.</Empty>}
      </div>
    </>
  );
}
