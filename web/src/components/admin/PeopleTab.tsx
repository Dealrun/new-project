'use client';
import { useState } from 'react';
import { useApp } from '@/components/AppContext';
import { Modal, SectionTitle, Tag } from '@/components/ui';
import { Any, DUTY, api, run, toast, useApi } from '@/lib/client';

export function PeopleTab() {
  const [people, reload] = useApi<Any[]>('/people');
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<Any | null>(null);
  if (!people) return <div className="loading">불러오는 중…</div>;

  const reveal = (id: number) => run(async () => {
    const r = await api(`/people/${id}/reveal`, { method: 'POST', body: { purpose: '인원 목록에서 전화번호 확인' } });
    setRevealed((x) => ({ ...x, [id]: r.phone }));
  });

  return (
    <div className="card">
      <SectionTitle eyebrow="People" title={`인원 ${people.filter((p) => p.active).length}명`} sub="재직 기준"
        right={<button className="btn primary" onClick={() => setEditing({})}>인원 등록</button>} />
      <div className="hint" style={{ marginTop: -6, marginBottom: 12 }}>휴대폰 번호는 가려서 표시하며, [보기]·[수정]으로 열람하면 개인정보 접근 기록이 남습니다.</div>
      <div className="table-wrap"><table>
        <thead><tr><th>이름</th><th>계급</th><th>부서</th><th>근무 종류</th><th>계정 ID</th><th>군 메일</th><th>휴대폰</th><th>상태</th><th /></tr></thead>
        <tbody>{people.map((p) => (
          <tr key={p.id} className={p.active ? '' : 'inactive'}>
            <td><b>{p.name}</b>{p.is_admin ? <> <span className="badge blue">간부</span></> : null}</td>
            <td>{p.rank}</td><td>{p.dept}</td>
            <td>{p.duties.length ? p.duties.map((d: string) => <Tag key={d} duty={d} />) : '-'}</td>
            <td>{p.login_id}</td><td>{p.email || '-'}</td>
            <td>{revealed[p.id] ?? (p.phone_masked || '미등록')} {p.phone_masked && !revealed[p.id] && <button className="btn sm" onClick={() => reveal(p.id)}>보기</button>}</td>
            <td>{p.active ? '재직' : <span className="badge">비활성</span>}</td>
            <td><button className="btn sm" onClick={() => run(async () => setEditing(await api('/people/' + p.id)))}>수정</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      {editing && <PersonModal person={editing} onClose={() => setEditing(null)} onDone={reload} />}
    </div>
  );
}

function PersonModal({ person, onClose, onDone }: { person: Any; onClose: () => void; onDone: () => void }) {
  const { meta, reloadMe } = useApp();
  const isNew = !person.id;
  const [f, setF] = useState({
    name: person.name || '', rank: person.rank || '', dept: person.dept || '', login_id: person.login_id || '',
    email: person.email || '', phone: person.phone || '', duties: (person.duties || []) as string[],
    active: isNew ? true : !!person.active, is_admin: !!person.is_admin,
  });
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const toggleDuty = (d: string) => set('duties', f.duties.includes(d) ? f.duties.filter((x) => x !== d) : [...f.duties, d]);
  const text = (k: keyof typeof f, label: string, extra: Any = {}) => (
    <label className="field">{label}<input type={k === 'email' ? 'email' : 'text'} value={f[k] as string} onChange={(e) => set(k, e.target.value)} {...extra} /></label>
  );

  const save = () => run(async () => {
    await api(isNew ? '/people' : '/people/' + person.id, { method: isNew ? 'POST' : 'PUT', body: f });
    toast('저장했습니다.');
    onClose();
    onDone();
    reloadMe();
  });

  return (
    <Modal title={isNew ? '인원 등록' : '인원 정보 수정'} onClose={onClose} actions={<button className="btn primary" onClick={save}>저장</button>}>
      <div className="form-grid">
        {text('name', '이름')}{text('rank', '계급')}{text('dept', '소속 부서', { list: 'dept-list' })}
        {text('login_id', '인트라넷 계정 ID')}{text('email', '군 메일')}{text('phone', '휴대폰 번호', { placeholder: '010-0000-0000' })}
      </div>
      <datalist id="dept-list">{meta.all_depts.map((x: string) => <option key={x} value={x} />)}</datalist>
      <div>
        <div className="small muted">근무 종류 (복수 선택)</div>
        <div className="checks">{Object.keys(DUTY).map((k) => <label key={k}><input type="checkbox" checked={f.duties.includes(k)} onChange={() => toggleDuty(k)} />{DUTY[k]}</label>)}</div>
        <div className="checks">
          <label><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />재직(편성 대상)</label>
          <label><input type="checkbox" checked={f.is_admin} onChange={(e) => set('is_admin', e.target.checked)} />편성 담당 간부(관리자 권한)</label>
        </div>
      </div>
      <div className="small muted">비상대기는 소속 부서별로 순번이 따로 돌아갑니다. 인원·근무 종류를 바꾸면 다음 편성부터 순번에 반영됩니다.</div>
    </Modal>
  );
}
