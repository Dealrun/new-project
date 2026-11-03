'use strict';

// ---------- 공통 ----------
const DUTY = { dangjik: '당직사관', iljik: '일직사관', bisang: '비상대기', chachul: '차출' };
const SHORT = { dangjik: '당직', iljik: '일직', bisang: '비상' };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const SWAP_STATUS = { pending: ['대기', 'warn'], accepted: ['수락', 'ok'], rejected: ['거절', 'fail'], cancelled: ['취소', ''] };
const KIND = { reminder: '전날 알림', change: '근무 변경', swap_request: '교대 요청', swap_done: '교대 성립', draw: '차출 선발', confirm: '근무표 확정' };

let ME = null, META = null;
const S = { month: null, duty: 'all', dept: 'all', mineOnly: false, adminTab: 'plan', planMonth: null, notifyFilter: '' };

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = () => $('#view');

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/me') { location.reload(); }
  if (!res.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}

function toast(msg, error = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), error ? 5000 : 3000);
}

// 비동기 버튼 동작: 실패하면 오류 토스트
async function run(fn) {
  try { await fn(); } catch (e) { toast(e.message, true); }
}

function openModal(html) {
  $('#modal-root').innerHTML = `<div class="modal-back"><div class="modal">${html}</div></div>`;
  const back = $('#modal-root .modal-back');
  back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
  back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  return $('#modal-root .modal');
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function fmtDate(s) {
  const d = new Date(s + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}
function slotLabel(duty, dept) { return duty === 'bisang' && dept ? `${DUTY[duty]}(${dept})` : DUTY[duty]; }
function tag(duty) { return `<span class="tag ${duty}">${SHORT[duty] || DUTY[duty]}</span>`; }
function monthAdd(m, n) {
  let [y, mo] = m.split('-').map(Number);
  mo += n;
  while (mo > 12) { mo -= 12; y++; }
  while (mo < 1) { mo += 12; y--; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}
function monthLabel(m) { const [y, mo] = m.split('-'); return `${y}년 ${Number(mo)}월`; }
function dday(date) {
  const diff = Math.round((new Date(date + 'T00:00:00') - new Date(META.today + 'T00:00:00')) / 86400000);
  return diff === 0 ? '오늘' : diff === 1 ? '내일' : `D-${diff}`;
}
function statusBadge(st) {
  return st === 'confirmed' ? '<span class="badge ok">확정</span>'
    : st === 'draft' ? '<span class="badge warn">초안</span>' : '<span class="badge">미편성</span>';
}
function swapBadge(st) { const [t, c] = SWAP_STATUS[st] || [st, '']; return `<span class="badge ${c}">${t}</span>`; }
function options(list, selected) {
  return list.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

// ---------- 로그인 ----------
async function renderLogin() {
  const opt = await api('/auth/options');
  const users = opt.users || [];
  $('#app').innerHTML = `
    <div class="login">
      <h1>OnDuty</h1>
      <p class="muted">당직·일직·비상대기·차출 근무 편성과 알림</p>
      <div class="card">
        <button class="btn" disabled title="연동 규격(X1) 수신 후 사용">군 인트라넷 계정으로 로그인 (연동 준비 중)</button>
        ${opt.dev_login ? `
          <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
          <b>개발·시연용 임시 로그인</b>
          <div class="small muted">관리자가 등록한 계정을 선택합니다. 운영 전환 시 비활성화됩니다.</div>
          <select id="login-user">
            <optgroup label="편성 담당 간부">${options(users.filter((u) => u.is_admin).map((u) => [u.id, `${u.rank} ${u.name} (${u.dept})`]))}</optgroup>
            <optgroup label="근무자">${options(users.filter((u) => !u.is_admin).map((u) => [u.id, `${u.rank} ${u.name} (${u.dept})`]))}</optgroup>
          </select>
          <button class="btn primary" id="login-btn">로그인</button>` : '<p class="muted">임시 로그인이 비활성화되어 있습니다.</p>'}
      </div>
    </div>`;
  const btn = $('#login-btn');
  if (btn) btn.onclick = () => run(async () => {
    await api('/auth/dev', { method: 'POST', body: { person_id: Number($('#login-user').value) } });
    location.hash = '#/home';
    boot();
  });
}

// ---------- 앱 골격 ----------
async function boot() {
  try {
    const r = await api('/me');
    ME = r.user; META = r.meta;
  } catch (e) { return renderLogin(); }
  S.month = S.month || META.today.slice(0, 7);
  S.planMonth = S.planMonth || monthAdd(META.today.slice(0, 7), 1);
  const testMode = !META.channels.mail || !META.channels.alimtalk;
  const links = [['#/home', '오늘 · 내 근무'], ['#/calendar', '월간 근무표']];
  if (ME.is_admin) links.push(['#/admin', '편성 관리'], ['#/notify', '알림 관리']);
  $('#app').innerHTML = `
    <header class="topbar">
      <div class="brand">OnDuty</div>
      <nav class="nav">${links.map(([h, t]) => `<a href="${h}" data-nav="${h}">${t}</a>`).join('')}</nav>
      <div class="userbox">
        <span>${esc(ME.rank)} ${esc(ME.name)}</span>
        <span class="role">${ME.is_admin ? '간부(관리자)' : '근무자'}</span>
        <button id="logout">로그아웃</button>
      </div>
    </header>
    ${testMode ? `<div class="testbar">테스트 모드: ${!META.channels.mail ? '군 메일' : ''}${!META.channels.mail && !META.channels.alimtalk ? '·' : ''}${!META.channels.alimtalk ? '알림톡' : ''} 연동 정보가 없어 실제 발송 없이 알림 기록에만 남깁니다.</div>` : ''}
    <main id="view"></main>`;
  $('#logout').onclick = () => run(async () => { await api('/auth/logout', { method: 'POST' }); location.hash = ''; boot(); });
  window.onhashchange = route;
  route();
}

function route() {
  const h = location.hash || '#/home';
  const page = h.split('/')[1] || 'home';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === '#/' + page));
  const pages = { home: pageHome, calendar: pageCalendar, admin: pageAdmin, notify: pageNotify };
  const fn = (!ME.is_admin && (page === 'admin' || page === 'notify')) ? pageHome : (pages[page] || pageHome);
  run(fn);
}

// ---------- S1 오늘 · 내 근무 ----------
async function pageHome() {
  const d = await api('/home');
  const todayRows = d.today_slots.sort((a, b) => (a.duty > b.duty ? 1 : -1));
  const byDuty = (duty) => todayRows.filter((s) => s.duty === duty);
  const todayLine = (s) => `<li>${tag(s.duty)}<span>${s.duty === 'bisang' ? esc(s.dept) + ' ' : ''}<b>${esc(s.name || '미배정')}</b></span>${s.mine ? '<span class="badge warn">나</span>' : ''}</li>`;
  const a = d.admin;
  view().innerHTML = `
    ${a ? `<div class="card"><h2>간부 확인 사항</h2><div class="row">
      ${a.drafts.length ? `<a class="badge warn" href="#/admin">확정 대기 초안: ${a.drafts.map(monthLabel).join(', ')}</a>` : '<span class="badge ok">확정 대기 초안 없음</span>'}
      ${a.failed ? `<a class="badge fail" href="#/notify">알림 발송 실패 ${a.failed}건</a>` : '<span class="badge ok">발송 실패 없음</span>'}
      <span class="badge">보충 대기열 ${a.makeup}명</span>
      <span class="badge">처리 대기 교대 ${a.pending_swaps}건</span>
    </div></div>` : ''}
    <div class="grid2">
      <section class="card hero">
        <h2>내 다음 근무</h2>
        ${d.next ? `<div class="big">${fmtDate(d.next.date)} ${slotLabel(d.next.duty, d.next.dept)}</div><span class="dday">${dday(d.next.date)}</span>`
          : `<div class="muted">${ME.is_admin && !ME.duties.length ? '근무 대상이 아닌 관리자 계정입니다.' : '확정된 근무표에 예정된 근무가 없습니다.'}</div>`}
        ${d.upcoming.length > 1 ? `<div class="small muted" style="margin-top:12px">이후 근무: ${d.upcoming.slice(1, 6).map((r) => `${fmtDate(r.date)} ${SHORT[r.duty]}`).join(' · ')}</div>` : ''}
        ${d.unavail.length ? `<div class="small muted" style="margin-top:8px">등록된 휴가·출장: ${d.unavail.map((u) => `${u.kind} ${fmtDate(u.start)}~${fmtDate(u.end)}`).join(', ')}</div>` : ''}
      </section>
      <section class="card">
        <h2>오늘 근무자 <small>${fmtDate(d.today)}</small></h2>
        ${todayRows.length ? `<ul class="list">${[...byDuty('dangjik'), ...byDuty('iljik'), ...byDuty('bisang')].map(todayLine).join('')}</ul>`
          : '<div class="empty">오늘 날짜의 확정된 근무표가 없습니다.</div>'}
      </section>
    </div>
    <div style="height:16px"></div>
    <section class="card">
      <h2>받은 교대 요청</h2>
      ${d.incoming.length ? `<ul class="list">${d.incoming.map((s) => `
        <li>${tag(s.duty)}<span><b>${esc(s.requester_name)}</b>님이 <b>${fmtDate(s.date)} ${esc(s.label)}</b> 근무를 대신 서 달라고 요청
        ${s.target_date ? ` · 대신 귀하의 <b>${fmtDate(s.target_date)}</b> 근무를 맡음(맞교대)` : ''}
        ${s.memo ? `<span class="muted">“${esc(s.memo)}”</span>` : ''}</span>
        <span class="spacer"></span>
        <button class="btn primary sm" data-swap="${s.id}" data-act="accept">수락</button>
        <button class="btn danger sm" data-swap="${s.id}" data-act="reject">거절</button></li>`).join('')}</ul>`
        : '<div class="empty">받은 교대 요청이 없습니다.</div>'}
    </section>
    <div class="grid2">
      <section class="card">
        <h2>이번 달 내 근무 <small>${monthLabel(d.today.slice(0, 7))}</small></h2>
        ${d.month_list.length ? `<ul class="list">${d.month_list.map((r) => `
          <li${r.date < d.today ? ' class="muted"' : ''}>${tag(r.duty)}<span>${fmtDate(r.date)} ${slotLabel(r.duty, r.dept)}</span>
          ${r.date >= d.today ? `<span class="spacer"></span><button class="btn sm" data-req='${esc(JSON.stringify(r))}'>교대 요청</button>` : '<span class="small">지남</span>'}</li>`).join('')}</ul>`
          : '<div class="empty">이번 달 근무가 없습니다.</div>'}
      </section>
      <section class="card">
        <h2>보낸 교대 요청</h2>
        ${d.outgoing.length ? `<ul class="list">${d.outgoing.map((s) => `
          <li>${swapBadge(s.status)}<span>${fmtDate(s.date)} ${esc(s.label)} → <b>${esc(s.target_name)}</b>${s.target_date ? ` (맞교대 ${fmtDate(s.target_date)})` : ''}</span>
          ${s.status === 'pending' ? `<span class="spacer"></span><button class="btn sm" data-swap="${s.id}" data-act="cancel">취소</button>` : ''}</li>`).join('')}</ul>`
          : '<div class="empty">보낸 교대 요청이 없습니다.</div>'}
      </section>
    </div>`;
  view().querySelectorAll('[data-swap]').forEach((b) => b.onclick = () => run(async () => {
    const act = b.dataset.act;
    if (act === 'accept' && !confirm('교대를 수락하면 근무표가 바로 바뀝니다. 수락할까요?')) return;
    await api(`/swaps/${b.dataset.swap}/${act}`, { method: 'POST' });
    toast({ accept: '교대가 성립되어 근무표에 반영했습니다.', reject: '요청을 거절했습니다.', cancel: '요청을 취소했습니다.' }[act]);
    pageHome();
  }));
  view().querySelectorAll('[data-req]').forEach((b) => b.onclick = () => openSwapModal(JSON.parse(b.dataset.req), pageHome));
}

// ---------- 교대 요청 모달 ----------
async function openSwapModal(slot, after) {
  const cands = await api(`/swap-candidates?date=${slot.date}&duty=${slot.duty}&dept=${encodeURIComponent(slot.dept || '')}`);
  const m = openModal(`
    <h3>교대 요청</h3>
    <div class="stack">
      <div>${tag(slot.duty)}<b>${fmtDate(slot.date)} ${slotLabel(slot.duty, slot.dept)}</b> (내 근무)</div>
      <label class="field">교대 대상자 (같은 근무 종류만)
        <select id="sw-target"><option value="">선택하세요</option>${cands.map((c) =>
          `<option value="${c.id}" ${c.problems.length ? 'disabled' : ''}>${esc(c.name)} · ${esc(c.dept)}${c.problems.length ? ` (불가: ${c.problems.join(', ')})` : ''}</option>`).join('')}</select>
      </label>
      <label class="field">맞교대 (선택): 상대방 근무 중 내가 대신 설 날짜
        <select id="sw-tdate"><option value="">맞교대 없이 대신 서 주기만 요청</option></select>
      </label>
      <label class="field">메모 (선택)<input type="text" id="sw-memo" maxlength="100" placeholder="예: 가족 행사"></label>
      <div class="small muted">상대방이 수락하면 근무표가 바로 바뀌고 두 사람과 간부에게 알림이 갑니다.</div>
    </div>
    <div class="actions"><button class="btn" data-close>닫기</button><button class="btn primary" id="sw-send">교대 요청 보내기</button></div>`);
  $('#sw-target', m).onchange = (e) => {
    const c = cands.find((x) => String(x.id) === e.target.value);
    $('#sw-tdate', m).innerHTML = '<option value="">맞교대 없이 대신 서 주기만 요청</option>' +
      (c ? c.dates.filter((d) => d !== slot.date).map((d) => `<option value="${d}">${fmtDate(d)}</option>`).join('') : '');
  };
  $('#sw-send', m).onclick = () => run(async () => {
    const target = $('#sw-target', m).value;
    if (!target) throw new Error('교대 대상자를 선택하세요.');
    await api('/swaps', { method: 'POST', body: { date: slot.date, duty: slot.duty, dept: slot.dept || '', target: Number(target),
      target_date: $('#sw-tdate', m).value || null, memo: $('#sw-memo', m).value } });
    closeModal();
    toast('교대 요청을 보냈습니다. 상대방에게 알림이 갔습니다.');
    after && after();
  });
}

// ---------- 간부 칸 수정 모달 ----------
async function openEditModal(slot, after) {
  const cands = await api(`/cell-candidates?date=${slot.date}&duty=${slot.duty}&dept=${encodeURIComponent(slot.dept || '')}`);
  const m = openModal(`
    <h3>근무 칸 수정</h3>
    <div class="stack">
      <div>${tag(slot.duty)}<b>${fmtDate(slot.date)} ${slotLabel(slot.duty, slot.dept)}</b> · 현재: ${esc(slot.name || '미배정')}</div>
      <label class="field">근무자
        <select id="ed-person"><option value="">(미배정)</option>${cands.map((c) =>
          `<option value="${c.id}" ${c.id === slot.person_id ? 'selected' : ''}>${esc(c.name)} · ${esc(c.dept)}${c.problems.length ? ` ⚠ ${c.problems.join(', ')}` : ''}</option>`).join('')}</select>
      </label>
      <label class="field">수정 사유<input type="text" id="ed-reason" placeholder="예: 본인 요청, 훈련 일정"></label>
      <div class="small muted">모든 수정은 변경 기록에 남습니다. 확정된 근무표를 고치면 해당 인원에게 즉시 알림이 갑니다.</div>
    </div>
    <div class="actions"><button class="btn" data-close>닫기</button><button class="btn primary" id="ed-save">저장</button></div>`);
  const save = async (force) => {
    const r = await api('/schedule/cell', { method: 'POST', body: { date: slot.date, duty: slot.duty, dept: slot.dept || '',
      person_id: $('#ed-person', m).value || null, reason: $('#ed-reason', m).value, force } });
    if (r.warnings) {
      if (confirm(`규칙 위반: ${r.warnings.join(', ')}\n그래도 배정할까요?`)) return save(true);
      return;
    }
    closeModal();
    toast('수정했습니다.');
    after && after();
  };
  $('#ed-save', m).onclick = () => run(() => save(false));
}

// ---------- S2 월간 근무표 ----------
async function pageCalendar() {
  const d = await api('/schedule?month=' + S.month);
  const depts = META.depts;
  const pending = new Set(d.pending_swaps.map((p) => `${p.date}|${p.duty}|${p.dept}`));
  const first = new Date(S.month + '-01T00:00:00').getDay();
  const showSlot = (s) => (S.duty === 'all' || s.duty === S.duty) && (s.duty !== 'bisang' || S.dept === 'all' || s.dept === S.dept) && (!S.mineOnly || s.mine);
  const canEdit = ME.is_admin;
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="day blank"></div>');
  for (const day of d.days) {
    const dt = new Date(day.date + 'T00:00:00');
    const cls = ['day', day.daytype === 'weekend' ? 'weekend' : '', day.date === META.today ? 'today' : ''].join(' ');
    const slots = day.slots.filter(showSlot).map((s) => {
      const mineClickable = s.mine && d.status === 'confirmed' && day.date >= META.today;
      const clickable = canEdit || mineClickable;
      const key = `${s.date}|${s.duty}|${s.dept}`;
      return `<button class="slot ${s.mine ? 'mine' : ''} ${clickable ? 'clickable' : ''} ${s.person_id ? '' : 'empty-slot'} ${pending.has(key) ? 'pending' : ''}"
        ${clickable ? `data-slot='${esc(JSON.stringify(s))}'` : ''} title="${esc(slotLabel(s.duty, s.dept) + ' ' + (s.name || '미배정'))}">
        <span class="k ${s.duty}">${s.duty === 'bisang' ? esc(s.dept.slice(0, 2)) : SHORT[s.duty]}</span>${esc(s.name || '미배정')}</button>`;
    }).join('');
    cells.push(`<div class="${cls}"><div class="dnum" data-dow=" (${WD[dt.getDay()]})">${dt.getDate()}${day.holiday ? `<span class="hname">${esc(day.holiday)}</span>` : ''}</div>${slots}</div>`);
  }
  view().innerHTML = `
    <div class="card">
      <div class="cal-head">
        <button class="btn" id="prev">◀</button><h2>${monthLabel(S.month)}</h2><button class="btn" id="next">▶</button>
        <button class="btn sm" id="thismonth">이번 달</button>
        ${statusBadge(d.status)}
        <span class="spacer"></span>
        <select id="f-duty">${options([['all', '근무 전체'], ['dangjik', '당직사관'], ['iljik', '일직사관'], ['bisang', '비상대기']], S.duty)}</select>
        <select id="f-dept">${options([['all', '부서 전체'], ...depts.map((x) => [x, x])], S.dept)}</select>
        <label class="row small"><input type="checkbox" id="f-mine" ${S.mineOnly ? 'checked' : ''}>내 근무만</label>
      </div>
      ${d.status === 'draft' && ME.is_admin ? '<div class="alert warn">초안입니다. 근무자에게는 아직 보이지 않습니다. 칸을 눌러 수정한 뒤 [편성 관리]에서 확정하세요.</div>' : ''}
      ${!d.visible ? `<div class="alert warn">${monthLabel(S.month)} 근무표가 아직 ${d.status === 'draft' ? '확정되지 않았습니다' : '편성되지 않았습니다'}.</div>` : ''}
      ${d.visible ? `<div class="cal">${WD.map((w, i) => `<div class="dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('')}${cells.join('')}</div>
      <div class="legend">
        <span><i style="background:var(--weekend-bg)"></i>주말·공휴일 (별도 순번)</span>
        <span><i style="background:var(--mine);border-color:var(--mine-line)"></i>내 근무 ${d.status === 'confirmed' ? '(눌러서 교대 요청)' : ''}</span>
        <span>⇄ 교대 요청 처리 중</span>
        ${canEdit ? '<span>간부: 칸을 눌러 수동 수정</span>' : ''}
      </div>` : ''}
    </div>`;
  $('#prev').onclick = () => { S.month = monthAdd(S.month, -1); route(); };
  $('#next').onclick = () => { S.month = monthAdd(S.month, 1); route(); };
  $('#thismonth').onclick = () => { S.month = META.today.slice(0, 7); route(); };
  $('#f-duty').onchange = (e) => { S.duty = e.target.value; route(); };
  $('#f-dept').onchange = (e) => { S.dept = e.target.value; route(); };
  $('#f-mine').onchange = (e) => { S.mineOnly = e.target.checked; route(); };
  view().querySelectorAll('[data-slot]').forEach((b) => b.onclick = () => run(async () => {
    const s = JSON.parse(b.dataset.slot);
    if (s.mine && d.status === 'confirmed' && s.date >= META.today && (!canEdit || confirm('내 근무입니다. 교대 요청을 보낼까요?\n(취소를 누르면 간부 수정 화면으로 갑니다)'))) {
      return openSwapModal(s, pageCalendar);
    }
    if (canEdit) return openEditModal(s, pageCalendar);
  }));
}

// ---------- S3 편성 관리 ----------
const ADMIN_TABS = [['plan', '자동 편성·확정'], ['people', '인원 관리'], ['unavail', '휴가·출장'], ['holidays', '공휴일'],
  ['draw', '차출 뽑기'], ['queue', '순번·보충 대기열'], ['log', '변경 기록'], ['settings', '설정']];

async function pageAdmin() {
  view().innerHTML = `<div class="tabs">${ADMIN_TABS.map(([k, t]) => `<button data-tab="${k}" class="${S.adminTab === k ? 'active' : ''}">${t}</button>`).join('')}</div><div id="tab"></div>`;
  view().querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { S.adminTab = b.dataset.tab; pageAdmin(); });
  const tabs = { plan: tabPlan, people: tabPeople, unavail: tabUnavail, holidays: tabHolidays, draw: tabDraw, queue: tabQueue, log: tabLog, settings: tabSettings };
  await tabs[S.adminTab]();
}
const tabEl = () => $('#tab');

async function tabPlan() {
  const m = S.planMonth;
  const [months, v] = await Promise.all([api('/months'), api('/validate?month=' + m)]);
  const st = (months.find((x) => x.month === m) || {}).status;
  const later = months.some((x) => x.month > m);
  const cols = [['dangjik_weekday', '당직 평일'], ['dangjik_weekend', '당직 주말'], ['iljik_weekday', '일직 평일'], ['iljik_weekend', '일직 주말'],
    ['bisang_weekday', '비상 평일'], ['bisang_weekend', '비상 주말']];
  tabEl().innerHTML = `
    <div class="card">
      <div class="cal-head">
        <button class="btn" id="pm-prev">◀</button><h2>${monthLabel(m)}</h2><button class="btn" id="pm-next">▶</button>
        ${statusBadge(st)}
        <span class="spacer"></span>
        <button class="btn primary" id="gen" ${st === 'confirmed' || later ? 'disabled' : ''}>${st === 'draft' ? '다시 자동 편성' : '자동 편성'}</button>
        <button class="btn primary" id="confirm" ${st !== 'draft' ? 'disabled' : ''}>확정</button>
        <button class="btn danger" id="del" ${st !== 'draft' || later ? 'disabled' : ''}>초안 삭제</button>
        <a class="btn" href="#/calendar" id="to-cal">달력에서 보기·수정</a>
      </div>
      <div class="small muted">순서: ① 휴가·출장과 공휴일 입력 → ② [자동 편성] → ③ 달력에서 확인·수동 수정 → ④ [확정] (확정되면 전 인원이 보고 알림이 갑니다)
      ${later ? '<br>이후 달 편성이 있어 이 달은 다시 편성하거나 삭제할 수 없습니다.' : ''}</div>
    </div>
    ${st ? `
    <div class="card">
      <h2>편성 결과 검증 <small>규칙 R2(휴가·출장) · R4(같은 날 중복) · R5(연속 근무)</small></h2>
      ${v.issues.length ? `<div class="alert fail">확인이 필요한 칸 ${v.issues.length}개</div><ul class="list">${v.issues.map((i) =>
        `<li><b>${esc(i.slot)}</b> ${esc(i.person)} <span class="badge fail">${i.problems.map(esc).join(', ')}</span></li>`).join('')}</ul>`
        : '<div class="alert ok">규칙을 어긴 배정이 없습니다. 모든 칸이 채워졌습니다.</div>'}
    </div>
    <div class="card">
      <h2>인원별 근무 횟수 <small>평일·주말 순번을 따로 돌린 결과</small></h2>
      <div class="table-wrap"><table><thead><tr><th>인원</th><th>부서</th>${cols.map(([, t]) => `<th class="num">${t}</th>`).join('')}<th class="num">합계</th></tr></thead>
      <tbody>${v.counts.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.dept)}</td>${cols.map(([k]) => `<td class="num">${r[k] || ''}</td>`).join('')}<td class="num"><b>${r.total}</b></td></tr>`).join('')}</tbody></table></div>
    </div>` : ''}`;
  $('#pm-prev').onclick = () => { S.planMonth = monthAdd(m, -1); tabPlan(); };
  $('#pm-next').onclick = () => { S.planMonth = monthAdd(m, 1); tabPlan(); };
  $('#to-cal').onclick = () => { S.month = m; };
  $('#gen').onclick = () => run(async () => {
    if (st === 'draft' && !confirm('현재 초안(수동 수정 포함)을 버리고 다시 편성할까요?')) return;
    const r = await api(`/months/${m}/generate`, { method: 'POST' });
    toast(`${monthLabel(m)} 자동 편성 완료${r.unfilled ? ` (미배정 ${r.unfilled}칸)` : ''}`);
    tabPlan();
  });
  $('#confirm').onclick = () => run(async () => {
    if (!confirm(`${monthLabel(m)} 근무표를 확정할까요? 전 인원이 볼 수 있게 되고 근무자에게 알림이 갑니다.`)) return;
    await api(`/months/${m}/confirm`, { method: 'POST' });
    toast('확정했습니다. 근무자에게 알림이 발송되었습니다.');
    tabPlan();
  });
  $('#del').onclick = () => run(async () => {
    if (!confirm('초안을 삭제하고 순번을 편성 전 상태로 되돌릴까요?')) return;
    await api(`/months/${m}/delete`, { method: 'POST' });
    toast('초안을 삭제했습니다.');
    tabPlan();
  });
}

async function tabPeople() {
  const people = await api('/people');
  tabEl().innerHTML = `
    <div class="card">
      <div class="row"><h2 style="margin:0">인원 ${people.filter((p) => p.active).length}명 <small>재직 기준</small></h2><span class="spacer"></span><button class="btn primary" id="add">인원 등록</button></div>
      <div class="small muted" style="margin:6px 0 10px">휴대폰 번호는 가려서 표시하며, [보기]·[수정]으로 열람하면 개인정보 접근 기록이 남습니다.</div>
      <div class="table-wrap"><table>
        <thead><tr><th>이름</th><th>계급</th><th>부서</th><th>근무 종류</th><th>계정 ID</th><th>군 메일</th><th>휴대폰</th><th>상태</th><th></th></tr></thead>
        <tbody>${people.map((p) => `<tr class="${p.active ? '' : 'inactive'}">
          <td><b>${esc(p.name)}</b>${p.is_admin ? ' <span class="badge ok">간부</span>' : ''}</td><td>${esc(p.rank)}</td><td>${esc(p.dept)}</td>
          <td>${p.duties.map(tag).join('') || '-'}</td><td>${esc(p.login_id)}</td><td>${esc(p.email || '-')}</td>
          <td><span id="ph-${p.id}">${esc(p.phone_masked || '미등록')}</span> ${p.phone_masked ? `<button class="btn sm" data-reveal="${p.id}">보기</button>` : ''}</td>
          <td>${p.active ? '재직' : '<span class="badge">비활성</span>'}</td>
          <td><button class="btn sm" data-edit="${p.id}">수정</button></td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
  $('#add').onclick = () => personModal(null);
  tabEl().querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => run(async () => personModal(await api('/people/' + b.dataset.edit))));
  tabEl().querySelectorAll('[data-reveal]').forEach((b) => b.onclick = () => run(async () => {
    const r = await api(`/people/${b.dataset.reveal}/reveal`, { method: 'POST', body: { purpose: '인원 목록에서 전화번호 확인' } });
    $('#ph-' + b.dataset.reveal).textContent = r.phone;
    b.remove();
  }));
}

function personModal(p) {
  const isNew = !p;
  p = p || { name: '', rank: '', dept: '', login_id: '', email: '', phone: '', duties: [], active: 1, is_admin: 0 };
  const m = openModal(`
    <h3>${isNew ? '인원 등록' : '인원 정보 수정'}</h3>
    <div class="form-grid">
      <label class="field">이름<input type="text" id="p-name" value="${esc(p.name)}"></label>
      <label class="field">계급<input type="text" id="p-rank" value="${esc(p.rank)}"></label>
      <label class="field">소속 부서<input type="text" id="p-dept" value="${esc(p.dept)}" list="dept-list"></label>
      <label class="field">인트라넷 계정 ID<input type="text" id="p-login" value="${esc(p.login_id)}"></label>
      <label class="field">군 메일<input type="email" id="p-email" value="${esc(p.email)}"></label>
      <label class="field">휴대폰 번호<input type="text" id="p-phone" value="${esc(p.phone)}" placeholder="010-0000-0000"></label>
    </div>
    <datalist id="dept-list">${META.all_depts.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
    <div class="field small muted" style="margin-top:12px">근무 종류 (복수 선택)</div>
    <div class="checks">${['dangjik', 'iljik', 'bisang', 'chachul'].map((k) => `<label><input type="checkbox" name="duty" value="${k}" ${p.duties.includes(k) ? 'checked' : ''}>${DUTY[k]}</label>`).join('')}</div>
    <div class="checks">
      <label><input type="checkbox" id="p-active" ${p.active ? 'checked' : ''}>재직(편성 대상)</label>
      <label><input type="checkbox" id="p-admin" ${p.is_admin ? 'checked' : ''}>편성 담당 간부(관리자 권한)</label>
    </div>
    <div class="small muted">비상대기는 소속 부서별로 순번이 따로 돌아갑니다. 인원·근무 종류를 바꾸면 다음 편성부터 순번에 반영됩니다.</div>
    <div class="actions"><button class="btn" data-close>닫기</button><button class="btn primary" id="p-save">저장</button></div>`);
  $('#p-save', m).onclick = () => run(async () => {
    const body = {
      name: $('#p-name', m).value, rank: $('#p-rank', m).value, dept: $('#p-dept', m).value, login_id: $('#p-login', m).value,
      email: $('#p-email', m).value, phone: $('#p-phone', m).value,
      duties: [...m.querySelectorAll('input[name=duty]:checked')].map((x) => x.value),
      active: $('#p-active', m).checked, is_admin: $('#p-admin', m).checked,
    };
    await api(isNew ? '/people' : '/people/' + p.id, { method: isNew ? 'POST' : 'PUT', body });
    closeModal();
    toast('저장했습니다.');
    const r = await api('/me'); META = r.meta;
    tabPeople();
  });
}

async function tabUnavail() {
  const [list, people] = await Promise.all([api('/unavail'), api('/people')]);
  const active = people.filter((p) => p.active && p.duties.length);
  tabEl().innerHTML = `
    <div class="card">
      <h2>휴가·출장 등록</h2>
      <div class="form-grid">
        <label class="field">인원<select id="u-person">${options(active.map((p) => [p.id, `${p.rank} ${p.name} (${p.dept})`]))}</select></label>
        <label class="field">구분<select id="u-kind">${options([['휴가', '휴가'], ['출장', '출장']])}</select></label>
        <label class="field">시작일<input type="date" id="u-start" value="${META.today}"></label>
        <label class="field">종료일<input type="date" id="u-end" value="${META.today}"></label>
        <label class="field">메모<input type="text" id="u-memo" placeholder="선택"></label>
        <button class="btn primary" id="u-add">등록</button>
      </div>
      <div class="small muted" style="margin-top:8px">이미 편성된 날짜에 걸리면 <b>해당 날짜만</b> 다음 순번으로 다시 편성하고(R6), 빠진 사람은 보충 대기열에 올려 복귀 후 먼저 배정합니다(R3). 바뀐 사람에게는 즉시 알림이 갑니다.</div>
      <div id="u-result"></div>
    </div>
    <div class="card">
      <h2>등록된 휴가·출장</h2>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>인원</th><th>구분</th><th>기간</th><th>메모</th><th>등록</th><th></th></tr></thead><tbody>
      ${list.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.kind)}</td><td>${u.start} ~ ${u.end}</td><td>${esc(u.memo)}</td><td class="small muted">${esc(u.created || '')}</td>
      <td><button class="btn sm danger" data-del="${u.id}">삭제</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">등록된 휴가·출장이 없습니다.</div>'}
    </div>`;
  $('#u-start').onchange = (e) => { if ($('#u-end').value < e.target.value) $('#u-end').value = e.target.value; };
  $('#u-add').onclick = () => run(async () => {
    const r = await api('/unavail', { method: 'POST', body: { person_id: Number($('#u-person').value), kind: $('#u-kind').value,
      start: $('#u-start').value, end: $('#u-end').value, memo: $('#u-memo').value } });
    toast(r.changes.length ? `등록 완료 · ${r.changes.length}개 칸을 다시 편성했습니다.` : '등록 완료 · 바뀐 근무 칸이 없습니다.');
    await tabUnavail();
    if (r.changes.length) {
      $('#u-result').innerHTML = `<div class="alert ok" style="margin-top:12px"><b>부분 재편성 결과</b><br>${r.changes.map((c) => `${esc(c.slot)}: ${esc(c.before)} → <b>${esc(c.after)}</b>`).join('<br>')}</div>`;
    }
  });
  tabEl().querySelectorAll('[data-del]').forEach((b) => b.onclick = () => run(async () => {
    if (!confirm('삭제할까요? 이미 바뀐 근무표는 되돌리지 않습니다.')) return;
    await api('/unavail/' + b.dataset.del, { method: 'DELETE' });
    tabUnavail();
  }));
}

async function tabHolidays() {
  const list = await api('/holidays');
  tabEl().innerHTML = `
    <div class="card">
      <h2>공휴일 지정</h2>
      <div class="form-grid">
        <label class="field">날짜<input type="date" id="h-date" value="${META.today}"></label>
        <label class="field">명칭<input type="text" id="h-name" placeholder="예: 성탄절"></label>
        <button class="btn primary" id="h-add">추가</button>
      </div>
      <div class="small muted" style="margin-top:8px">공휴일은 주말과 같은 <b>주말·공휴일 순번</b>으로 편성됩니다(R1). 편성 <b>전에</b> 입력하세요.</div>
    </div>
    <div class="card"><h2>지정된 공휴일</h2>
      ${list.length ? `<ul class="list">${list.map((h) => `<li><b>${h.date}</b> ${fmtDate(h.date)} ${esc(h.name)}<span class="spacer"></span><button class="btn sm danger" data-del="${h.date}">해제</button></li>`).join('')}</ul>` : '<div class="empty">지정된 공휴일이 없습니다.</div>'}
    </div>`;
  $('#h-add').onclick = () => run(async () => {
    const r = await api('/holidays', { method: 'POST', body: { date: $('#h-date').value, name: $('#h-name').value } });
    toast(r.already_planned ? '추가했습니다. 이미 편성된 달이라 기존 배정은 바뀌지 않습니다(초안이면 다시 편성하세요).' : '추가했습니다.');
    tabHolidays();
  });
  tabEl().querySelectorAll('[data-del]').forEach((b) => b.onclick = () => run(async () => {
    await api('/holidays/' + b.dataset.del, { method: 'DELETE' });
    tabHolidays();
  }));
}

async function tabDraw() {
  const list = await api('/draws');
  tabEl().innerHTML = `
    <div class="card">
      <h2>차출 뽑기</h2>
      <div class="form-grid">
        <label class="field">필요 인원 수<input type="number" id="d-count" min="1" max="40" value="2"></label>
        <label class="field" style="grid-column: span 2">사유 메모<input type="text" id="d-memo" placeholder="예: 연대 작업 지원"></label>
        <button class="btn primary" id="d-go">차출 뽑기</button>
      </div>
      <div class="small muted" style="margin-top:8px">보충 대기열 → 차출 순번 순으로 뽑습니다. 오늘 휴가·출장 중이거나 다른 근무가 있는 인원은 건너뛰고 보충 대기열에 올립니다. 뽑힌 사람에게 즉시 알림이 갑니다.</div>
      <div id="d-result"></div>
    </div>
    <div class="card"><h2>차출 기록</h2>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>일시</th><th class="num">요청</th><th>선발 인원</th><th>사유</th><th>처리자</th></tr></thead><tbody>
      ${list.map((r) => `<tr><td>${esc(r.created)}</td><td class="num">${r.count}명</td><td>${r.names.map(esc).join(', ')}</td><td>${esc(r.memo)}</td><td>${esc(r.actor)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">차출 기록이 없습니다.</div>'}
    </div>`;
  $('#d-go').onclick = () => run(async () => {
    const count = Number($('#d-count').value);
    if (!confirm(`${count}명을 차출 순번에서 뽑고 알림을 보낼까요?`)) return;
    const r = await api('/draws', { method: 'POST', body: { count, memo: $('#d-memo').value } });
    await tabDraw();
    $('#d-result').innerHTML = `<div class="alert ok" style="margin-top:12px">선발: <b>${r.chosen.map(esc).join(', ')}</b>${r.short ? ` (가능 인원 부족으로 ${r.short}명 미선발)` : ''}</div>`;
  });
}

async function tabQueue() {
  const [rot, mk] = await Promise.all([api('/rotations'), api('/makeup')]);
  tabEl().innerHTML = `
    <div class="card"><h2>보충 대기열 <small>휴가·출장 등으로 건너뛴 인원. 다음 근무일에 먼저 배정됩니다(R3)</small></h2>
      ${mk.length ? `<div class="table-wrap"><table><thead><tr><th>인원</th><th>근무</th><th>구분</th><th>사유</th><th>등록</th><th></th></tr></thead><tbody>
      ${mk.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.label)}</td><td>${esc(r.daytype_label)}</td><td>${esc(r.reason)}</td><td class="small muted">${esc(r.created)}</td>
      <td><button class="btn sm danger" data-del="${r.id}">삭제</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">보충 대기 중인 인원이 없습니다.</div>'}
    </div>
    <div class="card"><h2>현재 순번 <small>다음에 배정될 5명 (보충 대기열이 먼저)</small></h2>
      <div class="table-wrap"><table><thead><tr><th>근무</th><th>구분</th><th class="num">인원</th><th>다음 순번</th></tr></thead><tbody>
      ${rot.map((r) => `<tr><td>${tag(r.duty)}${esc(r.label)}</td><td>${esc(r.daytype_label)}</td><td class="num">${r.size}</td><td>${r.next.map(esc).join(' → ')}</td></tr>`).join('')}
      </tbody></table></div>
    </div>`;
  tabEl().querySelectorAll('[data-del]').forEach((b) => b.onclick = () => run(async () => {
    if (!confirm('보충 대기열에서 삭제할까요? (보충 배정을 하지 않음)')) return;
    await api('/makeup/' + b.dataset.del, { method: 'DELETE' });
    tabQueue();
  }));
}

async function tabLog() {
  const [log, acc, swaps] = await Promise.all([api('/changelog'), api('/access-log'), api('/swaps')]);
  tabEl().innerHTML = `
    <div class="card"><h2>변경 기록 <small>재편성·교대·수동 수정 등 모든 변경 (R7)</small></h2>
      <div class="table-wrap"><table><thead><tr><th>일시</th><th>변경자</th><th>대상</th><th>변경 전</th><th>변경 후</th><th>사유</th></tr></thead><tbody>
      ${log.map((r) => `<tr><td class="small">${esc(r.ts)}</td><td>${esc(r.actor)}</td><td>${esc(r.target)}</td><td>${esc(r.before)}</td><td><b>${esc(r.after)}</b></td><td>${esc(r.reason)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="card"><h2>교대 요청 내역</h2>
      ${swaps.length ? `<div class="table-wrap"><table><thead><tr><th>요청일시</th><th>근무</th><th>요청자</th><th>대상자</th><th>맞교대</th><th>상태</th><th>처리</th></tr></thead><tbody>
      ${swaps.map((s) => `<tr><td class="small">${esc(s.created)}</td><td>${fmtDate(s.date)} ${esc(s.label)}</td><td>${esc(s.requester_name)}</td><td>${esc(s.target_name)}</td>
      <td>${s.target_date ? fmtDate(s.target_date) : '-'}</td><td>${swapBadge(s.status)}</td><td class="small">${esc(s.processed || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">교대 요청이 없습니다.</div>'}
    </div>
    <div class="card"><h2>개인정보 접근 기록 <small>변경 기록과 별도 보관</small></h2>
      ${acc.length ? `<div class="table-wrap"><table><thead><tr><th>일시</th><th>열람자</th><th>대상</th><th>항목</th><th>목적</th></tr></thead><tbody>
      ${acc.map((r) => `<tr><td class="small">${esc(r.ts)}</td><td>${esc(r.actor)}</td><td>${esc(r.name)}</td><td>${esc(r.field)}</td><td>${esc(r.purpose)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">접근 기록이 없습니다.</div>'}
    </div>`;
}

async function tabSettings() {
  tabEl().innerHTML = `
    <div class="card"><h2>편성 규칙 설정</h2>
      <div class="checks"><label><input type="checkbox" id="s-consec" ${META.no_consecutive ? 'checked' : ''}>
        연속 이틀 근무 금지 (R5, 같은 근무 종류 기준)</label></div>
      <div class="small muted">같은 날 두 가지 근무 금지(R4)는 항상 적용됩니다.</div>
    </div>
    <div class="card"><h2>연동 상태</h2>
      <ul class="list">
        <li>로그인<span class="spacer"></span>${META.dev_login ? '<span class="badge warn">임시 로그인 사용 중 (SSO 연동 전)</span>' : '<span class="badge ok">인트라넷 SSO</span>'}</li>
        <li>군 메일<span class="spacer"></span>${META.channels.mail ? '<span class="badge ok">연동됨</span>' : '<span class="badge warn">테스트 모드 (기록만)</span>'}</li>
        <li>알림톡<span class="spacer"></span>${META.channels.alimtalk ? '<span class="badge ok">연동됨</span>' : '<span class="badge warn">테스트 모드 (기록만)</span>'}</li>
        <li>전날 알림 예약 시각<span class="spacer"></span><b>매일 ${esc(META.daily_time)}</b></li>
      </ul>
      <div class="small muted">연동 정보(서버 주소·포트·발송 계정 등)는 서버 폴더의 config.json에서 설정합니다.</div>
    </div>`;
  $('#s-consec').onchange = (e) => run(async () => {
    await api('/settings', { method: 'PUT', body: { no_consecutive: e.target.checked } });
    META.no_consecutive = e.target.checked;
    toast('저장했습니다. 다음 편성부터 적용됩니다.');
  });
}

// ---------- S4 알림 관리 ----------
async function pageNotify() {
  const [up, notes, tpls, people] = await Promise.all([
    api('/notifications/upcoming'), api('/notifications' + (S.notifyFilter ? '?result=' + S.notifyFilter : '')), api('/templates'), api('/people')]);
  const failed = notes.summary.fail || 0;
  const sample = { name: '중위 김민준', date: fmtDate(up.date).replace(/^(\d+)\/(\d+)/, '$1월 $2일'), duty: '당직사관', detail: '(변경 내용)' };
  const preview = (t) => t.replace(/\{(\w+)\}/g, (m0, k) => sample[k] ?? m0);
  view().innerHTML = `
    <div class="grid2">
      <section class="card">
        <h2>발송 예정 <small>${esc(up.scheduled_at)} → ${fmtDate(up.date)} 근무자</small></h2>
        ${!up.confirmed ? '<div class="alert warn">내일 날짜의 근무표가 확정되지 않아 발송 대상이 없습니다.</div>' : ''}
        ${up.items.length ? `<ul class="list">${up.items.map((i) => `<li>${i.sent ? '<span class="badge ok">발송됨</span>' : '<span class="badge warn">예정</span>'}
          <span><b>${esc(i.person)}</b> · ${esc(i.slot)}<br><span class="small muted">${esc(i.content)}</span></span></li>`).join('')}</ul>` : '<div class="empty">발송 예정 알림이 없습니다.</div>'}
        <div class="row" style="margin-top:12px">
          <button class="btn" id="run-now">지금 바로 실행 (시연)</button>
          <span class="small muted">서버가 매일 ${esc(META.daily_time)}에 자동 실행 · 마지막 실행 ${esc(up.last_run || '없음')}</span>
        </div>
      </section>
      <section class="card">
        <h2>발송 결과</h2>
        <div class="row" style="margin-bottom:12px">
          <span class="badge ok">성공 ${notes.summary.success || 0}건</span>
          <span class="badge ${failed ? 'fail' : ''}">실패 ${failed}건</span>
          <span class="spacer"></span>
          <button class="btn primary" id="resend-all" ${failed ? '' : 'disabled'}>실패 건 모두 재발송</button>
        </div>
        ${failed ? '<div class="alert fail">실패 건은 대개 연락처 미등록입니다. [편성 관리 → 인원 관리]에서 연락처를 등록한 뒤 재발송하세요.</div>' : ''}
        <h3 style="font-size:14px;margin:14px 0 8px">전화번호 확인 (간부 전용, 접근 기록 남음)</h3>
        <div class="row">
          <select id="ph-person">${options(people.map((p) => [p.id, `${p.rank} ${p.name} (${p.dept})`]))}</select>
          <button class="btn" id="ph-show">확인</button>
          <span id="ph-out" class="muted"></span>
        </div>
      </section>
    </div>
    <div style="height:16px"></div>
    <section class="card">
      <div class="row"><h2 style="margin:0">발송 내역</h2><span class="spacer"></span>
        <select id="n-filter">${options([['', '전체'], ['success', '성공'], ['fail', '실패']], S.notifyFilter)}</select></div>
      <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>일시</th><th>대상</th><th>경로</th><th>종류</th><th>내용</th><th>결과</th><th></th></tr></thead><tbody>
      ${notes.items.map((n) => `<tr><td class="small">${esc(n.sent_at || n.created)}</td><td>${esc(n.name)}</td><td>${esc(n.channel_label)}</td><td>${esc(KIND[n.kind] || n.kind)}</td>
        <td class="small">${esc(n.content)}</td>
        <td>${n.result === 'success' ? `<span class="badge ok">성공</span>${n.note ? `<div class="small muted">${esc(n.note)}</div>` : ''}` : `<span class="badge fail">실패</span><div class="small">${esc(n.error)}</div>`}</td>
        <td>${n.result === 'fail' ? `<button class="btn sm" data-resend="${n.id}">재발송</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">내역이 없습니다.</td></tr>'}
      </tbody></table></div>
    </section>
    <section class="card">
      <h2>알림 문구 <small>{name} 이름 · {date} 날짜 · {duty} 근무 · {detail} 상세</small></h2>
      ${tpls.map((t) => `<div style="margin-bottom:14px">
        <div class="row"><b>${esc(t.label)}</b><span class="spacer"></span><button class="btn sm" data-tpl="${t.key}">저장</button><button class="btn sm" data-tpl-reset="${t.key}">기본값</button></div>
        <textarea rows="2" id="tpl-${t.key}" data-default="${esc(t.default)}">${esc(t.text)}</textarea>
        <div class="small muted">미리보기: <span id="tplp-${t.key}">${esc(preview(t.text))}</span></div></div>`).join('')}
    </section>`;
  $('#run-now').onclick = () => run(async () => {
    const r = await api('/notifications/run-daily', { method: 'POST' });
    toast(`${fmtDate(r.date)} 근무자 ${r.sent}명에게 알림을 생성했습니다.`);
    pageNotify();
  });
  $('#resend-all').onclick = () => run(async () => {
    const r = await api('/notifications/resend-failed', { method: 'POST' });
    toast(`${r.tried}건 재발송 · 여전히 실패 ${r.still_failed}건`, r.still_failed > 0);
    pageNotify();
  });
  $('#n-filter').onchange = (e) => { S.notifyFilter = e.target.value; pageNotify(); };
  $('#ph-show').onclick = () => run(async () => {
    const r = await api(`/people/${$('#ph-person').value}/reveal`, { method: 'POST', body: { purpose: '알림 관리 화면에서 전화번호 확인' } });
    $('#ph-out').textContent = `휴대폰 ${r.phone} · 메일 ${r.email}`;
  });
  view().querySelectorAll('[data-resend]').forEach((b) => b.onclick = () => run(async () => {
    const r = await api(`/notifications/${b.dataset.resend}/resend`, { method: 'POST' });
    toast(r.result === 'success' ? '재발송 성공' : `재발송 실패: ${r.error}`, r.result !== 'success');
    pageNotify();
  }));
  tpls.forEach((t) => {
    const ta = $('#tpl-' + t.key);
    ta.oninput = () => { $('#tplp-' + t.key).textContent = preview(ta.value); };
  });
  view().querySelectorAll('[data-tpl]').forEach((b) => b.onclick = () => run(async () => {
    await api('/templates', { method: 'PUT', body: { key: b.dataset.tpl, text: $('#tpl-' + b.dataset.tpl).value } });
    toast('문구를 저장했습니다.');
  }));
  view().querySelectorAll('[data-tpl-reset]').forEach((b) => b.onclick = () => {
    const ta = $('#tpl-' + b.dataset.tplReset);
    ta.value = ta.dataset.default;
    ta.oninput();
  });
}

boot();
