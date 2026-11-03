'use client';
import { useEffect, useState } from 'react';
import { Any, api, fmtDate, run, slotLabel, toast } from '@/lib/client';
import { Modal, Tag } from './ui';

export interface SlotRef { date: string; duty: string; dept: string; person_id: number | null; name?: string }

const q = (s: SlotRef) => `date=${s.date}&duty=${s.duty}&dept=${encodeURIComponent(s.dept || '')}`;

// 근무자: 같은 근무 종류 대상자에게 교대 요청
export function SwapModal({ slot, onClose, onDone }: { slot: SlotRef; onClose: () => void; onDone: () => void }) {
  const [cands, setCands] = useState<Any[] | null>(null);
  const [target, setTarget] = useState('');
  const [tdate, setTdate] = useState('');
  const [memo, setMemo] = useState('');
  useEffect(() => { run(async () => setCands(await api(`/swap-candidates?${q(slot)}`))); }, [slot]);
  const chosen = cands?.find((c) => String(c.id) === target);

  const send = () => run(async () => {
    if (!target) throw new Error('교대 대상자를 선택하세요.');
    await api('/swaps', { method: 'POST', body: { date: slot.date, duty: slot.duty, dept: slot.dept || '', target: Number(target), target_date: tdate || null, memo } });
    toast('교대 요청을 보냈습니다. 상대방에게 알림이 갔습니다.');
    onClose();
    onDone();
  });

  return (
    <Modal title="교대 요청" onClose={onClose} actions={<button className="btn primary" onClick={send}>교대 요청 보내기</button>}>
      <div><Tag duty={slot.duty} /><b>{fmtDate(slot.date)} {slotLabel(slot.duty, slot.dept)}</b> <span className="muted">(내 근무)</span></div>
      <label className="field">교대 대상자 (같은 근무 종류만)
        <select value={target} onChange={(e) => { setTarget(e.target.value); setTdate(''); }}>
          <option value="">{cands ? '선택하세요' : '불러오는 중…'}</option>
          {cands?.map((c) => (
            <option key={c.id} value={c.id} disabled={c.problems.length > 0}>
              {c.name} · {c.dept}{c.problems.length ? ` (불가: ${c.problems.join(', ')})` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">맞교대 (선택): 상대방 근무 중 내가 대신 설 날짜
        <select value={tdate} onChange={(e) => setTdate(e.target.value)}>
          <option value="">맞교대 없이 대신 서 주기만 요청</option>
          {chosen?.dates.filter((d: string) => d !== slot.date).map((d: string) => <option key={d} value={d}>{fmtDate(d)}</option>)}
        </select>
      </label>
      <label className="field">메모 (선택)<input type="text" maxLength={100} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 가족 행사" /></label>
      <div className="small muted">상대방이 수락하면 근무표가 바로 바뀌고 두 사람과 간부에게 알림이 갑니다.</div>
    </Modal>
  );
}

// 간부: 칸 수동 수정
export function EditCellModal({ slot, onClose, onDone }: { slot: SlotRef; onClose: () => void; onDone: () => void }) {
  const [cands, setCands] = useState<Any[] | null>(null);
  const [pid, setPid] = useState(slot.person_id ? String(slot.person_id) : '');
  const [reason, setReason] = useState('');
  useEffect(() => { run(async () => setCands(await api(`/cell-candidates?${q(slot)}`))); }, [slot]);

  const save = (force = false): Promise<void> => run(async () => {
    const r = await api('/schedule/cell', { method: 'POST', body: { date: slot.date, duty: slot.duty, dept: slot.dept || '', person_id: pid || null, reason, force } });
    if (r.warnings) {
      if (confirm(`규칙 위반: ${r.warnings.join(', ')}\n그래도 배정할까요?`)) await save(true);
      return;
    }
    toast('수정했습니다.');
    onClose();
    onDone();
  });

  return (
    <Modal title="근무 칸 수정" onClose={onClose} actions={<button className="btn primary" onClick={() => save()}>저장</button>}>
      <div><Tag duty={slot.duty} /><b>{fmtDate(slot.date)} {slotLabel(slot.duty, slot.dept)}</b> · 현재: {slot.name || '미배정'}</div>
      <label className="field">근무자
        <select value={pid} onChange={(e) => setPid(e.target.value)}>
          <option value="">(미배정)</option>
          {cands?.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.dept}{c.problems.length ? ` ⚠ ${c.problems.join(', ')}` : ''}</option>)}
        </select>
      </label>
      <label className="field">수정 사유<input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 본인 요청, 훈련 일정" /></label>
      <div className="small muted">모든 수정은 변경 기록에 남습니다. 확정된 근무표를 고치면 해당 인원에게 즉시 알림이 갑니다.</div>
    </Modal>
  );
}
