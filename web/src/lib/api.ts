// HTTP API. 요청 하나 = 트랜잭션 하나. 경로·권한 규칙은 아래 route() 목록에 모여 있다.
import { randomBytes } from 'node:crypto';
import { ApiError, addDays, fmtDate, monthDates, now, nowHM, parseDate, today } from './common';
import { Row, Tx, dbKind, getSetting, setSetting, withTx } from './db';
import { DAYTYPE_LABEL, DUTY_LABEL, UNAVAIL_KINDS, World, dutiesOf, slotLabel } from './engine';
import { CHANNELS, DEFAULT_TEMPLATES, TEMPLATE_LABELS, channelStatus, deliver } from './notifier';
import { SCHEMA } from './schema';
import { seedIfEmpty } from './seed';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Cookie { name: string; value: string; maxAge?: number }

interface Ctx {
  db: Tx;
  user: Row | null;
  query: URLSearchParams;
  body: Body;
  token?: string;
  cookies: Cookie[];
  actor: string;
}

type Handler = (c: Ctx, ...groups: string[]) => Promise<unknown>;
const ROUTES: { method: string; rx: RegExp; fn: Handler; admin: boolean; isPublic: boolean }[] = [];

function route(method: string, pattern: string, fn: Handler, opts: { admin?: boolean; isPublic?: boolean } = {}) {
  ROUTES.push({ method, rx: new RegExp('^' + pattern + '$'), fn, admin: !!opts.admin, isPublic: !!opts.isPublic });
}
const admin = { admin: true };

const devLogin = () => process.env.DEV_LOGIN !== 'false';
const dailyTime = () => process.env.DAILY_NOTIFY_TIME || '17:00';

// ---------- 준비(표 생성·시연 데이터) ----------
const g = globalThis as unknown as { __dutyReady?: Promise<void> };
function ensureReady() {
  if (!g.__dutyReady) {
    g.__dutyReady = withTx(async (db) => {
      await db.exec(SCHEMA);
      // 이전 이름으로 저장해 둔 알림 문구가 있으면 새 머리말로 바꾼다
      await db.ex("UPDATE settings SET value=REPLACE(value, '[근무순번도우미]', '[국방부]') WHERE key LIKE 'tpl_%'");
      await seedIfEmpty(db);
    }).catch((e) => { g.__dutyReady = undefined; throw e; });
  }
  return g.__dutyReady;
}

export async function handleApi(method: string, path: string, query: URLSearchParams, body: Body, token?: string) {
  const cookies: Cookie[] = [];
  try {
    await ensureReady();
    const payload = await withTx(async (db) => {
      for (const r of ROUTES) {
        if (r.method !== method) continue;
        const m = path.match(r.rx);
        if (!m) continue;
        const c: Ctx = { db, user: null, query, body, token, cookies, actor: '시스템' };
        if (!r.isPublic) {
          c.user = await userFromToken(db, token);
          if (!c.user) throw new ApiError(401, '로그인이 필요합니다.');
          if (r.admin && !c.user.is_admin) throw new ApiError(403, '편성 담당 간부만 사용할 수 있습니다.');
          c.actor = `${c.user.rank} ${c.user.name}`.trim();
          await maybeRunDaily(db);
        }
        return r.fn(c, ...m.slice(1));
      }
      throw new ApiError(404, '없는 API입니다.');
    });
    return { status: 200, payload, cookies };
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, payload: { error: e.message }, cookies: [] };
    console.error(e);
    return { status: 500, payload: { error: `서버 오류: ${(e as Error).message}` }, cookies: [] };
  }
}

// Vercel Cron(매일 17:00 KST)에서 호출
export async function runCron() {
  await ensureReady();
  return withTx(async (db) => {
    const sent = await runDailyFor(db, addDays(today(), 1));
    await setSetting(db, 'last_daily_run', today());
    return { sent };
  });
}

async function sentRefs(db: Tx, target: string) {
  const rows = await db.q("SELECT ref, person_id, channel FROM notifications WHERE kind='reminder' AND ref LIKE $1", [target + '|%']);
  return new Set(rows.map((r) => `${r.ref}#${r.person_id}#${r.channel}`));
}

async function runDailyFor(db: Tx, target: string, channels?: string[]) {
  const w = await World.load(db);
  const n = w.runDaily(target, dailyTime(), await sentRefs(db, target), channels);
  await w.flush(db);
  return n;
}

// 서버리스 환경에서 Cron이 늦거나 빠져도, 17:00 이후 첫 요청에서 한 번 실행한다.
async function maybeRunDaily(db: Tx) {
  const [h, m] = dailyTime().split(':').map(Number);
  const [hh, mm] = nowHM();
  if (hh * 60 + mm < h * 60 + m) return;
  if ((await getSetting(db, 'last_daily_run', '')) === today()) return;
  await runDailyFor(db, addDays(today(), 1));
  await setSetting(db, 'last_daily_run', today());
}

// ---------- 공통 ----------
async function userFromToken(db: Tx, token?: string) {
  if (!token) return null;
  return db.q1('SELECT p.* FROM sessions s JOIN people p ON p.id=s.person_id WHERE s.token=$1 AND p.active=1', [token]);
}

function require(body: Body, ...keys: string[]) {
  for (const k of keys) if (body[k] === undefined || body[k] === null || body[k] === '') throw new ApiError(400, `필수 항목이 비어 있습니다: ${k}`);
}

const maskPhone = (phone: string) => (phone ? '***-****-' + phone.slice(-4) : '');

function personOut(p: Row, isAdmin = false) {
  const d: Row = { id: p.id, name: p.name, rank: p.rank, dept: p.dept, duties: dutiesOf(p), active: p.active, is_admin: p.is_admin };
  if (isAdmin) Object.assign(d, { login_id: p.login_id, email: p.email, phone_masked: maskPhone(p.phone) });
  return d;
}

async function addLog(db: Tx, actor: string, target: string, before: string, after: string, reason = '') {
  await db.ex('INSERT INTO changelog(ts, actor, target, before, after, reason) VALUES($1,$2,$3,$4,$5,$6)', [now(), actor, target, before, after, reason]);
}

async function logAccess(c: Ctx, pid: number, field: string, purpose: string) {
  await c.db.ex('INSERT INTO access_log(ts, actor, person_id, field, purpose) VALUES($1,$2,$3,$4,$5)', [now(), c.actor, pid, field, purpose]);
}

const visible = (c: Ctx, w: World, month: string) => {
  const st = w.monthStatus(month);
  return st === 'confirmed' || (!!st && !!c.user!.is_admin);
};

function swapRow(w: World, s: Row) {
  return { ...s, requester_name: w.pname(s.requester), target_name: w.pname(s.target), label: slotLabel(s.duty, s.dept) };
}

const toInt = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ApiError(400, '숫자 형식이 올바르지 않습니다.');
  return n;
};

// ---------- 로그인 ----------
route('GET', '/auth/options', async (c) => {
  const out: Row = { dev_login: devLogin(), sso: false };
  if (devLogin()) out.users = (await c.db.q('SELECT * FROM people WHERE active=1 ORDER BY is_admin DESC, id')).map((p) => personOut(p));
  return out;
}, { isPublic: true });

route('POST', '/auth/dev', async (c) => {
  if (!devLogin()) throw new ApiError(403, '임시 로그인이 비활성화되어 있습니다.');
  const p = await c.db.q1('SELECT * FROM people WHERE id=$1 AND active=1', [toInt(c.body.person_id)]);
  if (!p) throw new ApiError(400, '계정을 찾을 수 없습니다.');
  const token = randomBytes(32).toString('base64url');
  await c.db.ex('INSERT INTO sessions(token, person_id, created) VALUES($1,$2,$3)', [token, p.id, now()]);
  c.cookies.push({ name: 'sid', value: token });
  return { ok: true };
}, { isPublic: true });

route('POST', '/auth/sso', async () => {
  // 군 인트라넷 계정 연동(X1): 규격 수신 후 여기서 토큰을 검증하고 login_id로 인원을 찾는다.
  throw new ApiError(501, '인트라넷 SSO 연동 규격(X1)을 받은 뒤 구현됩니다. 지금은 임시 로그인을 사용하세요.');
}, { isPublic: true });

route('POST', '/auth/logout', async (c) => {
  if (c.token) await c.db.ex('DELETE FROM sessions WHERE token=$1', [c.token]);
  c.cookies.push({ name: 'sid', value: '', maxAge: 0 });
  return { ok: true };
}, { isPublic: true });

route('GET', '/me', async (c) => {
  const people = await c.db.q('SELECT dept, duties, active FROM people');
  const depts = [...new Set(people.filter((p) => p.active && p.dept && dutiesOf(p).includes('bisang')).map((p) => p.dept))].sort();
  return {
    user: personOut(c.user!, !!c.user!.is_admin),
    meta: {
      today: today(), duty_labels: DUTY_LABEL, depts,
      all_depts: [...new Set(people.map((p) => p.dept).filter(Boolean))].sort(),
      channels: channelStatus(), daily_time: dailyTime(),
      no_consecutive: await getSetting(c.db, 'no_consecutive', true),
      dev_login: devLogin(), db: dbKind(),
    },
  };
});

// ---------- S1 오늘 · 내 근무 ----------
route('GET', '/home', async (c) => {
  const w = await World.load(c.db);
  const uid = c.user!.id, t = today();
  const todaySlots = visible(c, w, t.slice(0, 7))
    ? w.slotsOn(t).map((s) => ({ ...s, name: s.person_id ? w.pname(s.person_id) : '', mine: s.person_id === uid }))
    : [];
  const mine = [...w.sched.keys()].filter((d) => d >= t.slice(0, 7) + '-01' && w.monthStatus(d.slice(0, 7)) === 'confirmed').sort()
    .flatMap((d) => w.slotsOn(d).filter((s) => s.person_id === uid));
  const out: Row = {
    today: t, today_slots: todaySlots,
    next: mine.find((r) => r.date >= t) ?? null,
    month_list: mine.filter((r) => r.date.slice(0, 7) === t.slice(0, 7)),
    upcoming: mine.filter((r) => r.date >= t).slice(0, 10),
    incoming: (await c.db.q("SELECT * FROM swaps WHERE target=$1 AND status='pending' ORDER BY id", [uid])).map((s) => swapRow(w, s)),
    outgoing: (await c.db.q('SELECT * FROM swaps WHERE requester=$1 ORDER BY id DESC LIMIT 10', [uid])).map((s) => swapRow(w, s)),
    unavail: w.unavail.filter((u) => u.person_id === uid && u.end_date >= t).sort((a, b) => a.start_date.localeCompare(b.start_date)),
  };
  if (c.user!.is_admin) {
    out.admin = {
      failed: (await c.db.q1("SELECT COUNT(*)::int c FROM notifications WHERE result='fail'"))!.c,
      drafts: [...w.months].filter(([, m]) => m.status === 'draft').map(([k]) => k),
      makeup: w.makeup.length,
      pending_swaps: (await c.db.q1("SELECT COUNT(*)::int c FROM swaps WHERE status='pending'"))!.c,
    };
  }
  return out;
});

// ---------- S2 월간 근무표 ----------
route('GET', '/schedule', async (c) => {
  const w = await World.load(c.db);
  const month = c.query.get('month') || today().slice(0, 7);
  const show = visible(c, w, month);
  const uid = c.user!.id;
  const days = monthDates(month).map((d) => ({
    date: d, daytype: w.dayType(d), holiday: w.holiday(d),
    slots: show ? w.slotsOn(d).map((s) => ({ ...s, name: s.person_id ? w.pname(s.person_id) : '', mine: s.person_id === uid })) : [],
  }));
  const pending = await c.db.q("SELECT date, duty, dept FROM swaps WHERE status='pending' AND date LIKE $1", [month + '-%']);
  return { month, status: w.monthStatus(month), visible: show, days, pending_swaps: pending };
});

route('GET', '/cell-candidates', async (c) => {
  const w = await World.load(c.db);
  return w.cellCandidates(c.query.get('date') || '', c.query.get('duty') || '', c.query.get('dept') || '');
}, admin);

route('POST', '/schedule/cell', async (c) => {
  require(c.body, 'date', 'duty');
  const w = await World.load(c.db);
  const r = w.setCell(c.actor, c.body.date, c.body.duty, c.body.dept || '', c.body.person_id ? toInt(c.body.person_id) : null,
    c.body.reason || '', !!c.body.force);
  await w.flush(c.db);
  return r;
}, admin);

// ---------- S3 편성 관리 ----------
route('GET', '/months', async (c) => c.db.q('SELECT month, status, updated FROM months ORDER BY month'), admin);

route('POST', '/months/(\\d{4}-\\d{2})/(generate|confirm|delete)', async (c, month, action) => {
  const w = await World.load(c.db);
  let out: unknown = { ok: true };
  if (action === 'generate') out = w.generateMonth(month, c.actor);
  else if (action === 'confirm') w.confirmMonth(month, c.actor);
  else w.deleteMonth(month, c.actor);
  await w.flush(c.db);
  return out;
}, admin);

route('GET', '/validate', async (c) => (await World.load(c.db)).validateMonth(c.query.get('month') || ''), admin);

route('GET', '/people', async (c) => {
  const isAdmin = !!c.user!.is_admin;
  const rows = await c.db.q(isAdmin ? 'SELECT * FROM people ORDER BY id' : 'SELECT * FROM people WHERE active=1 ORDER BY id');
  return rows.map((p) => personOut(p, isAdmin));
});

async function personFields(c: Ctx, pid: number | null) {
  const b = c.body;
  require(b, 'name', 'login_id');
  const duties = (Array.isArray(b.duties) ? b.duties : []).filter((d: string) => d in DUTY_LABEL);
  if (duties.includes('bisang') && !b.dept) throw new ApiError(400, '비상대기 대상자는 소속 부서가 필요합니다.');
  if (await c.db.q1('SELECT id FROM people WHERE login_id=$1 AND id IS DISTINCT FROM $2', [String(b.login_id).trim(), pid])) {
    throw new ApiError(400, '이미 사용 중인 인트라넷 계정 ID입니다.');
  }
  const s = (v: unknown) => String(v ?? '').trim();
  return [s(b.name), s(b.rank), s(b.dept), s(b.login_id), s(b.email), s(b.phone), duties.join(','), b.active === false ? 0 : 1, b.is_admin ? 1 : 0];
}

route('POST', '/people', async (c) => {
  const f = await personFields(c, null);
  const r = await c.db.q1('INSERT INTO people(name, rank, dept, login_id, email, phone, duties, active, is_admin) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', f);
  await addLog(c.db, c.actor, `인원 ${f[1]} ${f[0]}`, '', '등록');
  return { id: r!.id };
}, admin);

route('GET', '/people/(\\d+)', async (c, pid) => {
  const p = await c.db.q1('SELECT * FROM people WHERE id=$1', [Number(pid)]);
  if (!p) throw new ApiError(404, '인원을 찾을 수 없습니다.');
  await logAccess(c, p.id, '군 메일, 휴대폰 번호', '인원 정보 수정 화면');
  return { ...personOut(p, true), phone: p.phone };
}, admin);

route('PUT', '/people/(\\d+)', async (c, pid) => {
  const old = await c.db.q1('SELECT * FROM people WHERE id=$1', [Number(pid)]);
  if (!old) throw new ApiError(404, '인원을 찾을 수 없습니다.');
  const f = await personFields(c, Number(pid));
  await c.db.ex('UPDATE people SET name=$1, rank=$2, dept=$3, login_id=$4, email=$5, phone=$6, duties=$7, active=$8, is_admin=$9 WHERE id=$10', [...f, Number(pid)]);
  const fields: [string, string][] = [['name', '이름'], ['rank', '계급'], ['dept', '부서'], ['login_id', '계정'], ['email', '메일'],
    ['phone', '전화'], ['duties', '근무 종류'], ['active', '재직'], ['is_admin', '권한']];
  const changed = fields.filter(([col], i) => String(f[i]) !== String(old[col] ?? '')).map(([, l]) => l);
  await addLog(c.db, c.actor, `인원 ${f[1]} ${f[0]}`, '', '정보 수정', changed.length ? changed.join(', ') + ' 변경' : '');
  return { ok: true };
}, admin);

route('POST', '/people/(\\d+)/reveal', async (c, pid) => {
  const p = await c.db.q1('SELECT * FROM people WHERE id=$1', [Number(pid)]);
  if (!p) throw new ApiError(404, '인원을 찾을 수 없습니다.');
  await logAccess(c, p.id, '휴대폰 번호', c.body.purpose || '전화번호 확인');
  return { phone: p.phone || '(미등록)', email: p.email || '(미등록)' };
}, admin);

route('GET', '/unavail', async (c) => {
  const w = await World.load(c.db);
  return [...w.unavail].sort((a, b) => b.start_date.localeCompare(a.start_date)).map((u) => ({ ...u, name: w.pname(u.person_id) }));
}, admin);

route('POST', '/unavail', async (c) => {
  const b = c.body;
  require(b, 'person_id', 'kind', 'start', 'end');
  if (!UNAVAIL_KINDS.includes(b.kind)) throw new ApiError(400, '구분은 휴가 또는 출장입니다.');
  parseDate(b.start); parseDate(b.end);
  if (b.start > b.end) throw new ApiError(400, '종료일이 시작일보다 빠릅니다.');
  const w = await World.load(c.db);
  const pid = toInt(b.person_id);
  if (!w.person(pid)) throw new ApiError(400, '인원을 찾을 수 없습니다.');
  const u = await c.db.q1('INSERT INTO unavail(person_id, kind, start_date, end_date, memo, created) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [pid, b.kind, b.start, b.end, b.memo || '', now()]);
  w.log(c.actor, `${b.kind} ${w.pname(pid)}`, '', `${b.start} ~ ${b.end}`, b.memo || '');
  const changes = w.rescheduleUnavail(u!, c.actor);
  await w.flush(c.db);
  return { id: u!.id, changes };
}, admin);

route('DELETE', '/unavail/(\\d+)', async (c, uid) => {
  const u = await c.db.q1('DELETE FROM unavail WHERE id=$1 RETURNING *', [Number(uid)]);
  if (u) {
    const p = await c.db.q1('SELECT rank, name FROM people WHERE id=$1', [u.person_id]);
    await addLog(c.db, c.actor, `${u.kind} ${p ? `${p.rank} ${p.name}` : ''}`, `${u.start_date} ~ ${u.end_date}`, '삭제', '이미 바뀐 근무표는 그대로 유지');
  }
  return { ok: true };
}, admin);

route('GET', '/holidays', async (c) => c.db.q('SELECT * FROM holidays ORDER BY date'));

route('POST', '/holidays', async (c) => {
  require(c.body, 'date', 'name');
  parseDate(c.body.date);
  await c.db.ex('INSERT INTO holidays(date, name) VALUES($1,$2) ON CONFLICT(date) DO UPDATE SET name=EXCLUDED.name', [c.body.date, c.body.name]);
  await addLog(c.db, c.actor, `공휴일 ${c.body.date}`, '', c.body.name);
  return { ok: true, already_planned: !!(await c.db.q1('SELECT 1 FROM months WHERE month=$1', [c.body.date.slice(0, 7)])) };
}, admin);

route('DELETE', '/holidays/(\\d{4}-\\d{2}-\\d{2})', async (c, date) => {
  await c.db.ex('DELETE FROM holidays WHERE date=$1', [date]);
  await addLog(c.db, c.actor, `공휴일 ${date}`, '지정', '해제');
  return { ok: true };
}, admin);

route('GET', '/draws', async (c) => {
  const w = await World.load(c.db);
  return (await c.db.q('SELECT * FROM draws ORDER BY id DESC')).map((r) => ({ ...r, names: JSON.parse(r.person_ids).map((p: number) => w.pname(p)) }));
}, admin);

route('POST', '/draws', async (c) => {
  const count = toInt(c.body.count);
  const memo = String(c.body.memo || '');
  const w = await World.load(c.db);
  const chosen = w.drawPick(count);
  const d = await c.db.q1('INSERT INTO draws(created, count, person_ids, memo, actor) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [now(), count, JSON.stringify(chosen), memo, c.actor]);
  const names = chosen.map((p) => w.pname(p));
  w.log(c.actor, `차출 #${d!.id}`, `요청 ${count}명`, names.join(', '), memo);
  for (const pid of chosen) w.notify(pid, 'draw', w.render('draw', { name: w.pname(pid), detail: memo }), `draw${d!.id}`);
  await w.flush(c.db);
  return { id: d!.id, chosen: names, short: count - chosen.length };
}, admin);

route('GET', '/makeup', async (c) => {
  const w = await World.load(c.db);
  return w.makeup.map((m) => ({ ...m, name: w.pname(m.person_id), label: slotLabel(m.duty, m.dept), daytype_label: DAYTYPE_LABEL[m.daytype] }));
}, admin);

route('DELETE', '/makeup/(\\d+)', async (c, mid) => {
  const m = await c.db.q1('DELETE FROM makeup WHERE id=$1 RETURNING *', [Number(mid)]);
  if (m) {
    const p = await c.db.q1('SELECT rank, name FROM people WHERE id=$1', [m.person_id]);
    await addLog(c.db, c.actor, `보충 대기열 ${p ? `${p.rank} ${p.name}` : ''}`, slotLabel(m.duty, m.dept), '삭제');
  }
  return { ok: true };
}, admin);

route('GET', '/rotations', async (c) => (await World.load(c.db)).rotationOverview(), admin);
route('GET', '/changelog', async (c) => c.db.q('SELECT * FROM changelog ORDER BY id DESC LIMIT 300'), admin);

route('GET', '/access-log', async (c) => {
  const rows = await c.db.q('SELECT a.*, p.rank, p.name FROM access_log a LEFT JOIN people p ON p.id=a.person_id ORDER BY a.id DESC LIMIT 200');
  return rows.map((r) => ({ ...r, name: r.name ? `${r.rank} ${r.name}` : '' }));
}, admin);

route('PUT', '/settings', async (c) => {
  if ('no_consecutive' in c.body) {
    const v = !!c.body.no_consecutive;
    await setSetting(c.db, 'no_consecutive', v);
    await addLog(c.db, c.actor, '설정: 연속 근무 금지(R5)', '', v ? '켬' : '끔');
  }
  return { ok: true };
}, admin);

// ---------- 교대 ----------
route('GET', '/swap-candidates', async (c) => {
  const w = await World.load(c.db);
  return w.swapCandidates(c.user!.id, c.query.get('date') || '', c.query.get('duty') || '', c.query.get('dept') || '');
});

route('POST', '/swaps', async (c) => {
  const b = c.body;
  require(b, 'date', 'duty', 'target');
  const w = await World.load(c.db);
  const me = c.user!.id, target = toInt(b.target), dept = b.dept || '', targetDate = b.target_date || null;
  w.checkSwapRequest(me, b.date, b.duty, dept, target, targetDate);
  if (await c.db.q1("SELECT 1 FROM swaps WHERE date=$1 AND duty=$2 AND dept=$3 AND status='pending'", [b.date, b.duty, dept])) {
    throw new ApiError(400, '이 근무에 대해 처리 대기 중인 교대 요청이 이미 있습니다.');
  }
  const s = await c.db.q1('INSERT INTO swaps(requester, target, date, duty, dept, target_date, status, memo, created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [me, target, b.date, b.duty, dept, targetDate, 'pending', b.memo || '', now()]);
  let detail = `${w.pname(me)}님이 ${fmtDate(b.date)} ${slotLabel(b.duty, dept)} 교대를 요청했습니다.`;
  if (targetDate) detail += ` (맞교대: 귀하의 ${fmtDate(targetDate)} 근무)`;
  w.notify(target, 'swap_request', w.render('swap_request', { name: w.pname(target), detail }), `swap${s!.id}`);
  await w.flush(c.db);
  return { id: s!.id };
});

route('POST', '/swaps/(\\d+)/(accept|reject|cancel)', async (c, sid, action) => {
  const s = await c.db.q1('SELECT * FROM swaps WHERE id=$1', [Number(sid)]);
  if (!s) throw new ApiError(404, '교대 요청을 찾을 수 없습니다.');
  if (s.status !== 'pending') throw new ApiError(400, '이미 처리된 요청입니다.');
  const me = c.user!.id;
  if ((action === 'accept' || action === 'reject') && s.target !== me) throw new ApiError(403, '본인에게 온 요청만 처리할 수 있습니다.');
  if (action === 'cancel' && s.requester !== me) throw new ApiError(403, '본인이 보낸 요청만 취소할 수 있습니다.');
  if (action === 'accept') {
    const w = await World.load(c.db);
    w.applySwap(s, me);
    await w.flush(c.db);
  }
  const status = { accept: 'accepted', reject: 'rejected', cancel: 'cancelled' }[action];
  await c.db.ex('UPDATE swaps SET status=$1, processed=$2 WHERE id=$3', [status, now(), s.id]);
  return { ok: true };
});

route('GET', '/swaps', async (c) => {
  const w = await World.load(c.db);
  return (await c.db.q('SELECT * FROM swaps ORDER BY id DESC LIMIT 100')).map((s) => swapRow(w, s));
}, admin);

// ---------- S4 알림 관리 ----------
route('GET', '/notifications', async (c) => {
  const result = c.query.get('result');
  const filtered = result === 'success' || result === 'fail';
  const rows = await c.db.q(`SELECT n.*, p.rank, p.name FROM notifications n LEFT JOIN people p ON p.id=n.person_id
    ${filtered ? 'WHERE n.result=$1' : ''} ORDER BY n.id DESC LIMIT 300`, filtered ? [result] : []);
  const summary: Row = {};
  for (const r of await c.db.q('SELECT result, COUNT(*)::int c FROM notifications GROUP BY result')) summary[r.result] = r.c;
  return { summary, items: rows.map((r) => ({ ...r, name: r.name ? `${r.rank} ${r.name}` : '', channel_label: CHANNELS[r.channel] })) };
}, admin);

async function redeliver(db: Tx, n: Row) {
  const p = await db.q1('SELECT * FROM people WHERE id=$1', [n.person_id]);
  const d = await deliver(p, n.channel, n.content);
  await db.ex('UPDATE notifications SET result=$1, error=$2, note=$3, sent_at=$4, attempts=attempts+1 WHERE id=$5', [d.result, d.error, d.note, now(), n.id]);
  return d;
}

route('POST', '/notifications/(\\d+)/resend', async (c, nid) => {
  const n = await c.db.q1('SELECT * FROM notifications WHERE id=$1', [Number(nid)]);
  if (!n) throw new ApiError(404, '알림 기록을 찾을 수 없습니다.');
  return redeliver(c.db, n);
}, admin);

route('POST', '/notifications/resend-failed', async (c) => {
  const rows = await c.db.q("SELECT * FROM notifications WHERE result='fail'");
  let still = 0;
  for (const n of rows) if ((await redeliver(c.db, n)).result === 'fail') still++;
  return { tried: rows.length, still_failed: still };
}, admin);

route('GET', '/notifications/upcoming', async (c) => {
  const w = await World.load(c.db);
  const target = addDays(today(), 1);
  const items = w.reminders(target, await sentRefs(c.db, target)).map((r) => ({ person: r.person, slot: r.label, content: r.content, sent: r.sent }));
  return {
    date: target, scheduled_at: `${today()} ${dailyTime()}`, confirmed: w.monthStatus(target.slice(0, 7)) === 'confirmed',
    items, last_run: w.setting('last_daily_run', null),
  };
}, admin);

route('POST', '/notifications/run-daily', async (c) => {
  const target = c.body.date || addDays(today(), 1);
  parseDate(target);
  const ch = c.body.channel;
  if (ch && !(ch in CHANNELS)) throw new ApiError(400, '알 수 없는 발송 경로입니다.');
  return { sent: await runDailyFor(c.db, target, ch ? [ch] : undefined), date: target, channel: ch || 'all' };
}, admin);

route('GET', '/templates', async (c) => {
  const w = await World.load(c.db);
  return Object.keys(DEFAULT_TEMPLATES).map((k) => ({ key: k, label: TEMPLATE_LABELS[k], text: w.template(k), default: DEFAULT_TEMPLATES[k] }));
}, admin);

route('PUT', '/templates', async (c) => {
  const key = c.body.key;
  if (!(key in DEFAULT_TEMPLATES)) throw new ApiError(400, '알 수 없는 문구입니다.');
  await setSetting(c.db, 'tpl_' + key, c.body.text || DEFAULT_TEMPLATES[key]);
  await addLog(c.db, c.actor, `알림 문구: ${TEMPLATE_LABELS[key]}`, '', '수정');
  return { ok: true };
}, admin);
