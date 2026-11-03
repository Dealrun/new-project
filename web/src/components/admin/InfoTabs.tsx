'use client';
// 순번·보충 대기열 / 변경 기록 / 설정
import { useApp } from '@/components/AppContext';
import { Empty, SectionTitle, SwapBadge, Tag } from '@/components/ui';
import { Any, api, fmtDate, run, toast, useApi } from '@/lib/client';

export function QueueTab() {
  const [rot] = useApi<Any[]>('/rotations');
  const [mk, reload] = useApi<Any[]>('/makeup');
  const del = (id: number) => run(async () => {
    if (!confirm('보충 대기열에서 삭제할까요? (보충 배정을 하지 않음)')) return;
    await api('/makeup/' + id, { method: 'DELETE' });
    reload();
  });
  return (
    <>
      <div className="card">
        <SectionTitle eyebrow="Make-up" title="보충 대기열" sub="휴가·출장 등으로 건너뛴 인원. 다음 근무일에 먼저 배정됩니다(R3)" />
        {mk?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>인원</th><th>근무</th><th>구분</th><th>사유</th><th>등록</th><th /></tr></thead>
            <tbody>{mk.map((r) => (
              <tr key={r.id ?? r.person_id + r.duty}><td><b>{r.name}</b></td><td>{r.label}</td><td>{r.daytype_label}</td><td>{r.reason}</td><td className="small muted">{r.created}</td>
                <td><button className="btn sm danger" onClick={() => del(r.id)}>삭제</button></td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>보충 대기 중인 인원이 없습니다.</Empty>}
      </div>
      <div className="card">
        <SectionTitle eyebrow="Rotation" title="현재 순번" sub="다음에 배정될 5명 (보충 대기열이 먼저)" />
        <div className="table-wrap"><table>
          <thead><tr><th>근무</th><th>구분</th><th className="num">인원</th><th>다음 순번</th></tr></thead>
          <tbody>{(rot || []).map((r) => (
            <tr key={r.duty + r.dept + r.daytype}><td><Tag duty={r.duty} />{r.label}</td><td>{r.daytype_label}</td><td className="num">{r.size}</td><td>{r.next.join(' → ')}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  );
}

export function LogTab() {
  const [log] = useApi<Any[]>('/changelog');
  const [acc] = useApi<Any[]>('/access-log');
  const [swaps] = useApi<Any[]>('/swaps');
  return (
    <>
      <div className="card">
        <SectionTitle eyebrow="History" title="변경 기록" sub="재편성·교대·수동 수정 등 모든 변경 (R7)" />
        <div className="table-wrap"><table>
          <thead><tr><th>일시</th><th>변경자</th><th>대상</th><th>변경 전</th><th>변경 후</th><th>사유</th></tr></thead>
          <tbody>{(log || []).map((r) => (
            <tr key={r.id}><td className="small">{r.ts}</td><td>{r.actor}</td><td>{r.target}</td><td>{r.before}</td><td><b>{r.after}</b></td><td>{r.reason}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="card">
        <SectionTitle eyebrow="Swaps" title="교대 요청 내역" />
        {swaps?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>요청일시</th><th>근무</th><th>요청자</th><th>대상자</th><th>맞교대</th><th>상태</th><th>처리</th></tr></thead>
            <tbody>{swaps.map((s) => (
              <tr key={s.id}><td className="small">{s.created}</td><td>{fmtDate(s.date)} {s.label}</td><td>{s.requester_name}</td><td>{s.target_name}</td>
                <td>{s.target_date ? fmtDate(s.target_date) : '-'}</td><td><SwapBadge status={s.status} /></td><td className="small">{s.processed || ''}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>교대 요청이 없습니다.</Empty>}
      </div>
      <div className="card">
        <SectionTitle eyebrow="Privacy" title="개인정보 접근 기록" sub="변경 기록과 별도 보관" />
        {acc?.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>일시</th><th>열람자</th><th>대상</th><th>항목</th><th>목적</th></tr></thead>
            <tbody>{acc.map((r) => <tr key={r.id}><td className="small">{r.ts}</td><td>{r.actor}</td><td>{r.name}</td><td>{r.field}</td><td>{r.purpose}</td></tr>)}</tbody>
          </table></div>
        ) : <Empty>접근 기록이 없습니다.</Empty>}
      </div>
    </>
  );
}

export function SettingsTab() {
  const { meta, reloadMe } = useApp();
  return (
    <>
      <div className="card">
        <SectionTitle eyebrow="Rules" title="편성 규칙 설정" />
        <div className="checks"><label><input type="checkbox" checked={meta.no_consecutive} onChange={(e) => run(async () => {
          await api('/settings', { method: 'PUT', body: { no_consecutive: e.target.checked } });
          await reloadMe();
          toast('저장했습니다. 다음 편성부터 적용됩니다.');
        })} />연속 이틀 근무 금지 (R5, 같은 근무 종류 기준)</label></div>
        <div className="hint">같은 날 두 가지 근무 금지(R4)는 항상 적용됩니다.</div>
      </div>
      <div className="card">
        <SectionTitle eyebrow="Notification" title="알림 설정" />
        <ul className="list">
          <li>발송 경로<span className="spacer" /><b>군 메일 · 알림톡</b></li>
          <li>전날 알림 예약 시각<span className="spacer" /><b>매일 {meta.daily_time}</b></li>
        </ul>
      </div>
    </>
  );
}
