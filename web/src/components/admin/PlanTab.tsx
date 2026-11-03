'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Empty, SectionTitle, StatusBadge } from '@/components/ui';
import { Any, S, api, monthAdd, monthLabel, run, toast } from '@/lib/client';

const COLS: [string, string][] = [['dangjik_weekday', '당직 평일'], ['dangjik_weekend', '당직 주말'], ['iljik_weekday', '일직 평일'],
  ['iljik_weekend', '일직 주말'], ['bisang_weekday', '비상 평일'], ['bisang_weekend', '비상 주말']];

export function PlanTab() {
  const [m, setM] = useState(S.planMonth);
  const [data, setData] = useState<{ months: Any[]; v: Any } | null>(null);
  const load = useCallback(() => run(async () => {
    const [months, v] = await Promise.all([api('/months'), api('/validate?month=' + m)]);
    setData({ months, v });
  }), [m]);
  useEffect(() => { load(); }, [load]);

  const move = (n: number) => { S.planMonth = monthAdd(m, n); setM(S.planMonth); };
  const st: string | null = data?.months.find((x: Any) => x.month === m)?.status ?? null;
  const later = !!data?.months.some((x: Any) => x.month > m);

  const action = (kind: 'generate' | 'confirm' | 'delete') => run(async () => {
    const ask = {
      generate: st === 'draft' ? '현재 초안(수동 수정 포함)을 버리고 다시 편성할까요?' : '',
      confirm: `${monthLabel(m)} 근무표를 확정할까요? 전 인원이 볼 수 있게 되고 근무자에게 알림이 갑니다.`,
      delete: '초안을 삭제하고 순번을 편성 전 상태로 되돌릴까요?',
    }[kind];
    if (ask && !confirm(ask)) return;
    const r = await api(`/months/${m}/${kind}`, { method: 'POST' });
    toast(kind === 'generate' ? `${monthLabel(m)} 자동 편성 완료${r.unfilled ? ` (미배정 ${r.unfilled}칸)` : ''}`
      : kind === 'confirm' ? '확정했습니다. 근무자에게 알림이 발송되었습니다.' : '초안을 삭제했습니다.');
    load();
  });

  return (
    <>
      <div className="card">
        <div className="cal-head" style={{ marginBottom: 10 }}>
          <button className="btn" onClick={() => move(-1)}>◀</button>
          <h2>{monthLabel(m)}</h2>
          <button className="btn" onClick={() => move(1)}>▶</button>
          {data && <StatusBadge status={st} />}
          <span className="spacer" />
          <button className="btn primary" disabled={!data || st === 'confirmed' || later} onClick={() => action('generate')}>{st === 'draft' ? '다시 자동 편성' : '자동 편성'}</button>
          <button className="btn primary" disabled={st !== 'draft'} onClick={() => action('confirm')}>확정</button>
          <button className="btn danger" disabled={st !== 'draft' || later} onClick={() => action('delete')}>초안 삭제</button>
          <Link className="btn" href="/calendar" onClick={() => { S.month = m; }}>달력에서 보기·수정</Link>
        </div>
        <div className="hint">① 휴가·출장과 공휴일 입력 → ② [자동 편성] → ③ 달력에서 확인·수동 수정 → ④ [확정] (확정되면 전 인원이 보고 알림이 갑니다)
          {later && <><br />이후 달 편성이 있어 이 달은 다시 편성하거나 삭제할 수 없습니다.</>}</div>
      </div>
      {data && st && (
        <>
          <div className="card">
            <SectionTitle eyebrow="Validation" title="편성 결과 검증" sub="R2 휴가·출장 · R4 같은 날 중복 · R5 연속 근무" />
            {data.v.issues.length ? (
              <>
                <div className="alert fail">확인이 필요한 칸 {data.v.issues.length}개</div>
                <ul className="list">{data.v.issues.map((i: Any, k: number) => <li key={k}><b>{i.slot}</b> {i.person} <span className="badge fail">{i.problems.join(', ')}</span></li>)}</ul>
              </>
            ) : <div className="alert ok">규칙을 어긴 배정이 없습니다. 모든 칸이 채워졌습니다.</div>}
          </div>
          <div className="card">
            <SectionTitle eyebrow="Balance" title="인원별 근무 횟수" sub="평일·주말 순번을 따로 돌린 결과" />
            {data.v.counts.length ? (
              <div className="table-wrap"><table>
                <thead><tr><th>인원</th><th>부서</th>{COLS.map(([, t]) => <th key={t} className="num">{t}</th>)}<th className="num">합계</th></tr></thead>
                <tbody>{data.v.counts.map((r: Any) => (
                  <tr key={r.id}><td>{r.name}</td><td>{r.dept}</td>{COLS.map(([k]) => <td key={k} className="num">{r[k] || ''}</td>)}<td className="num"><b>{r.total}</b></td></tr>
                ))}</tbody>
              </table></div>
            ) : <Empty>배정된 인원이 없습니다.</Empty>}
          </div>
        </>
      )}
    </>
  );
}
