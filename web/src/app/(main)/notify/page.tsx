'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppContext';
import { Empty, PageHero, SectionTitle } from '@/components/ui';
import { Any, KIND, S, api, fmtDate, fmtLong, run, toast, useApi } from '@/lib/client';

export default function NotifyPage() {
  const { meta } = useApp();
  const [filter, setFilterState] = useState(S.notifyFilter);
  const [up, reloadUp] = useApi<Any>('/notifications/upcoming');
  const [notes, reloadNotes] = useApi<Any>('/notifications' + (filter ? '?result=' + filter : ''));
  const [people] = useApi<Any[]>('/people');
  const [tpls] = useApi<Any[]>('/templates');
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [phPerson, setPhPerson] = useState('');
  const [phOut, setPhOut] = useState('');

  useEffect(() => { if (tpls) setTexts(Object.fromEntries(tpls.map((t) => [t.key, t.text]))); }, [tpls]);
  const reload = () => { reloadUp(); reloadNotes(); };
  const setFilter = (v: string) => { S.notifyFilter = v; setFilterState(v); };
  const failed = notes?.summary.fail || 0;
  const sample: Record<string, string> = { name: '중위 김민준', date: up ? fmtLong(up.date) : '', duty: '당직사관', detail: '(변경 내용)' };
  const preview = (t: string) => t.replace(/\{(\w+)\}/g, (m, k) => sample[k] ?? m);
  const send = (channel?: 'mail' | 'alimtalk') => run(async () => {
    const r = await api('/notifications/run-daily', { method: 'POST', body: { channel } });
    const via = channel === 'mail' ? '군 메일로' : channel === 'alimtalk' ? '알림톡으로' : '군 메일·알림톡으로';
    toast(r.sent ? `${fmtDate(r.date)} 근무자 ${r.sent}명에게 ${via} 발송했습니다.` : '새로 보낼 대상이 없습니다(이미 발송됨).');
    reload();
  });

  return (
    <>
      <PageHero eyebrow="Notification" title="알림 관리" desc={`매일 ${meta.daily_time}에 다음 날 근무자에게 군 메일·알림톡이 자동으로 나갑니다. 실패한 건은 여기서 다시 보냅니다.`} />
      <div className="container page">
        <div className="grid2">
          <div className="card">
            <SectionTitle eyebrow="Scheduled" title="발송 예정" sub={up ? `${up.scheduled_at} → ${fmtDate(up.date)} 근무자` : ''} />
            {up && !up.confirmed && <div className="alert warn">내일 날짜의 근무표가 확정되지 않아 발송 대상이 없습니다.</div>}
            {up?.items.length ? (
              <ul className="list">{up.items.map((i: Any, k: number) => (
                <li key={k}>
                  <span style={{ flex: 1, minWidth: 200 }}><b>{i.person}</b> · {i.slot}<br /><span className="small muted">{i.content}</span></span>
                  <span className={'badge ' + (i.sent.mail ? 'ok' : '')}>메일 {i.sent.mail ? '발송됨' : '예정'}</span>
                  <span className={'badge ' + (i.sent.alimtalk ? 'ok' : '')}>알림톡 {i.sent.alimtalk ? '발송됨' : '예정'}</span>
                </li>
              ))}</ul>
            ) : up && <Empty>발송 예정 알림이 없습니다.</Empty>}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary" disabled={!up?.items.length} onClick={() => send()}>지금 모두 발송</button>
              <button className="btn" disabled={!up?.items.length} onClick={() => send('mail')}>군 메일 발송</button>
              <button className="btn" disabled={!up?.items.length} onClick={() => send('alimtalk')}>알림톡 발송</button>
            </div>
            <div className="hint">매일 {meta.daily_time} 자동 발송 · 마지막 자동 발송 {up?.last_run || '없음'}</div>
          </div>
          <div className="card">
            <SectionTitle eyebrow="Result" title="발송 결과" />
            <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 14 }}>
              <div className="kpi"><b>{notes?.summary.success || 0}건</b><span>성공</span></div>
              <div className={'kpi' + (failed ? ' alertish' : '')}><b>{failed}건</b><span>실패</span></div>
            </div>
            <button className="btn primary block" disabled={!failed} onClick={() => run(async () => {
              const r = await api('/notifications/resend-failed', { method: 'POST' });
              toast(`${r.tried}건 재발송 · 여전히 실패 ${r.still_failed}건`, r.still_failed > 0);
              reload();
            })}>실패 건 모두 재발송</button>
            {failed > 0 && <div className="hint">실패 건은 대개 연락처 미등록입니다. [편성 관리 → 인원 관리]에서 연락처를 등록한 뒤 재발송하세요.</div>}
            <h3 style={{ fontSize: 15, margin: '22px 0 10px' }}>전화번호 확인 <span className="small muted">(간부 전용, 접근 기록 남음)</span></h3>
            <div className="row">
              <select value={phPerson} onChange={(e) => setPhPerson(e.target.value)}>
                {(people || []).map((p) => <option key={p.id} value={p.id}>{p.rank} {p.name} ({p.dept})</option>)}
              </select>
              <button className="btn" onClick={() => run(async () => {
                const id = phPerson || String(people?.[0]?.id ?? '');
                const r = await api(`/people/${id}/reveal`, { method: 'POST', body: { purpose: '알림 관리 화면에서 전화번호 확인' } });
                setPhOut(`휴대폰 ${r.phone} · 메일 ${r.email}`);
              })}>확인</button>
              <span className="muted small">{phOut}</span>
            </div>
          </div>
        </div>
        <div style={{ height: 20 }} />

        <div className="card">
          <SectionTitle eyebrow="History" title="발송 내역" right={
            <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">전체</option><option value="success">성공</option><option value="fail">실패</option></select>
          } />
          <div className="table-wrap"><table>
            <thead><tr><th>일시</th><th>대상</th><th>경로</th><th>종류</th><th>내용</th><th>결과</th><th /></tr></thead>
            <tbody>
              {(notes?.items || []).map((n: Any) => (
                <tr key={n.id}>
                  <td className="small">{n.sent_at || n.created}</td><td>{n.name}</td><td>{n.channel_label}</td><td>{KIND[n.kind] || n.kind}</td>
                  <td className="small">{n.content}</td>
                  <td>{n.result === 'success'
                    ? <span className="badge ok">성공</span>
                    : <><span className="badge fail">실패</span><div className="small">{n.error}</div></>}</td>
                  <td>{n.result === 'fail' && <button className="btn sm" onClick={() => run(async () => {
                    const r = await api(`/notifications/${n.id}/resend`, { method: 'POST' });
                    toast(r.result === 'success' ? '재발송 성공' : `재발송 실패: ${r.error}`, r.result !== 'success');
                    reload();
                  })}>재발송</button>}</td>
                </tr>
              ))}
              {notes && !notes.items.length && <tr><td colSpan={7} className="empty">내역이 없습니다.</td></tr>}
            </tbody>
          </table></div>
        </div>

        <div className="card">
          <SectionTitle eyebrow="Message" title="알림 문구" sub="{name} 이름 · {date} 날짜 · {duty} 근무 · {detail} 상세" />
          {(tpls || []).map((t) => (
            <div key={t.key} style={{ marginBottom: 18 }}>
              <div className="row" style={{ marginBottom: 6 }}><b>{t.label}</b><span className="spacer" />
                <button className="btn sm" onClick={() => run(async () => {
                  await api('/templates', { method: 'PUT', body: { key: t.key, text: texts[t.key] } });
                  toast('문구를 저장했습니다.');
                })}>저장</button>
                <button className="btn sm ghost" onClick={() => setTexts((x) => ({ ...x, [t.key]: t.default }))}>기본값</button>
              </div>
              <textarea rows={2} value={texts[t.key] ?? ''} onChange={(e) => setTexts((x) => ({ ...x, [t.key]: e.target.value }))} />
              <div className="small muted">미리보기: {preview(texts[t.key] ?? '')}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
