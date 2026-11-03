// 편성 엔진: 순번(평일/주말 분리), 보충 대기열, 규칙 R1~R7, 교대, 차출, 알림 생성.
// 요청마다 필요한 표를 한 번에 읽어 메모리에서 계산한 뒤(World), 바뀐 부분만 한꺼번에 저장한다(flush).
// → Supabase처럼 멀리 있는 DB에서도 왕복 횟수가 적어 빠르다.
import { ApiError, addDays, fmtDate, monthDates, now, today, weekday } from './common';
import { Row, Tx, insertMany } from './db';
import { CHANNELS, DEFAULT_TEMPLATES, deliver, renderTemplate } from './notifier';

export const DUTY_LABEL: Record<string, string> = { dangjik: '당직사관', iljik: '일직사관', bisang: '비상대기', chachul: '차출' };
export const DAILY_DUTIES = ['dangjik', 'iljik', 'bisang'];
export const DAYTYPE_LABEL: Record<string, string> = { weekday: '평일', weekend: '주말·공휴일', all: '전체' };
export const UNAVAIL_KINDS = ['휴가', '출장'];
const DUTY_ORDER: Record<string, number> = { dangjik: 0, iljik: 1, bisang: 2 };

export const slotLabel = (duty: string, dept = '') =>
  duty === 'bisang' && dept ? `${DUTY_LABEL[duty]}(${dept})` : DUTY_LABEL[duty];
export const dutiesOf = (p: Row) => String(p.duties || '').split(',').filter(Boolean);

const sk = (duty: string, dept: string) => `${duty}|${dept}`;
const rotKey = (duty: string, dept: string, daytype: string) => `${duty}|${dept}|${daytype}`;

interface Rot { duty: string; dept: string; daytype: string; order: number[]; pos: number }
interface Makeup { id: number | null; person_id: number; duty: string; dept: string; daytype: string; reason: string; created: string }
interface Month { status: string; snapshot: string; updated: string }
export interface Slot { date: string; duty: string; dept: string; person_id: number | null }
interface Snapshot { rotations: Row[]; makeup: Row[] }

export class World {
  people: Row[] = [];
  byId = new Map<number, Row>();
  holidays = new Map<string, string>();
  sched = new Map<string, Map<string, number | null>>(); // 날짜 → '근무|부서' → 인원
  unavail: Row[] = [];
  makeup: Makeup[] = [];
  rots = new Map<string, Rot>();
  months = new Map<string, Month>();
  settings = new Map<string, unknown>();

  private dirtySlots = new Set<string>();
  private clearedMonths = new Set<string>();
  private rotsDirty = false;
  private makeupDirty = false;
  private dirtyMonths = new Set<string>();
  private deletedMonths = new Set<string>();
  private dirtySettings = new Set<string>();
  private logs: unknown[][] = [];
  private notes: { pid: number; kind: string; content: string; ref: string | null; scheduledAt: string | null; channels: string[] }[] = [];

  static async load(db: Tx) {
    const w = new World();
    w.people = await db.q('SELECT * FROM people ORDER BY id');
    for (const p of w.people) w.byId.set(p.id, p);
    for (const h of await db.q('SELECT * FROM holidays')) w.holidays.set(h.date, h.name);
    for (const s of await db.q('SELECT * FROM schedule')) w.put(s.date, s.duty, s.dept, s.person_id);
    w.unavail = await db.q('SELECT * FROM unavail');
    w.makeup = (await db.q('SELECT * FROM makeup ORDER BY id')) as Makeup[];
    for (const r of await db.q('SELECT * FROM rotations')) {
      w.rots.set(r.key, { duty: r.duty, dept: r.dept, daytype: r.daytype, order: JSON.parse(r.order_json), pos: r.pos });
    }
    for (const m of await db.q('SELECT * FROM months')) w.months.set(m.month, { status: m.status, snapshot: m.snapshot, updated: m.updated });
    for (const s of await db.q('SELECT * FROM settings')) w.settings.set(s.key, JSON.parse(s.value));
    return w;
  }

  // ---------- 기본 조회 ----------
  person(pid: number | null | undefined) { return pid ? this.byId.get(pid) ?? null : null; }
  pname(pid: number | null | undefined) {
    const p = this.person(pid);
    return p ? `${p.rank} ${p.name}`.trim() : '(미배정)';
  }
  holiday(date: string) { return this.holidays.get(date) ?? null; }
  dayType(date: string) {
    const wd = weekday(date);
    return wd === 0 || wd === 6 || this.holidays.has(date) ? 'weekend' : 'weekday';
  }
  bisangDepts() {
    return [...new Set(this.people.filter((p) => p.active && p.dept && dutiesOf(p).includes('bisang')).map((p) => p.dept as string))].sort();
  }
  dailySlots(): [string, string][] {
    return [['dangjik', ''], ['iljik', ''], ...this.bisangDepts().map((d) => ['bisang', d] as [string, string])];
  }
  monthStatus(month: string) { return this.months.get(month)?.status ?? null; }
  admins() { return this.people.filter((p) => p.is_admin && p.active).map((p) => p.id as number); }
  setting<T>(key: string, def: T): T { return this.settings.has(key) ? (this.settings.get(key) as T) : def; }
  setSetting(key: string, value: unknown) { this.settings.set(key, value); this.dirtySettings.add(key); }

  log(actor: string, target: string, before: string, after: string, reason = '') {
    this.logs.push([now(), actor, target, before, after, reason]);
  }
  template(key: string) { return this.setting('tpl_' + key, DEFAULT_TEMPLATES[key]); }
  render(key: string, vars: Record<string, string>) { return renderTemplate(this.template(key), vars); }
  notify(pid: number, kind: string, content: string, ref: string | null = null, scheduledAt: string | null = null,
    channels = Object.keys(CHANNELS)) {
    this.notes.push({ pid, kind, content, ref, scheduledAt, channels });
  }

  // ---------- 근무표 칸 ----------
  private put(date: string, duty: string, dept: string, pid: number | null) {
    if (!this.sched.has(date)) this.sched.set(date, new Map());
    this.sched.get(date)!.set(sk(duty, dept), pid);
  }
  get(date: string, duty: string, dept = '') { return this.sched.get(date)?.get(sk(duty, dept)); }
  set(date: string, duty: string, dept: string, pid: number | null) {
    this.put(date, duty, dept, pid);
    this.dirtySlots.add(`${date}|${duty}|${dept}`);
  }
  slotsOn(date: string): Slot[] {
    const out: Slot[] = [];
    for (const [k, pid] of this.sched.get(date) ?? []) {
      const [duty, dept] = k.split('|');
      out.push({ date, duty, dept, person_id: pid });
    }
    return out.sort((a, b) => DUTY_ORDER[a.duty] - DUTY_ORDER[b.duty] || a.dept.localeCompare(b.dept));
  }
  monthSlots(month: string) {
    return [...this.sched.keys()].filter((d) => d.startsWith(month + '-')).sort().flatMap((d) => this.slotsOn(d));
  }
  private clearMonth(month: string) {
    for (const d of [...this.sched.keys()]) if (d.startsWith(month + '-')) this.sched.delete(d);
    this.clearedMonths.add(month);
  }

  // ---------- 순번 / 보충 대기열 ----------
  pool(duty: string, dept = '') {
    return this.people
      .filter((p) => p.active && dutiesOf(p).includes(duty) && (duty !== 'bisang' || p.dept === dept))
      .map((p) => p.id as number);
  }

  // 저장된 순서를 현재 인원과 맞춘다(비활성 인원 제거, 신규 인원 뒤에 추가)
  getRotation(duty: string, dept: string, daytype: string): [number[], number] {
    const ids = this.pool(duty, dept);
    const r = this.rots.get(rotKey(duty, dept, daytype));
    if (!r) return [ids, 0];
    const idSet = new Set(ids);
    const fresh = [...r.order.filter((i) => idSet.has(i)), ...ids.filter((i) => !r.order.includes(i))];
    const remaining = r.pos >= 0 && r.pos < r.order.length ? r.order.slice(r.pos).filter((i) => idSet.has(i)) : [];
    return [fresh, remaining.length ? fresh.indexOf(remaining[0]) : 0];
  }
  private saveRotation(duty: string, dept: string, daytype: string, order: number[], pos: number) {
    this.rots.set(rotKey(duty, dept, daytype), { duty, dept, daytype, order, pos });
    this.rotsDirty = true;
  }
  addMakeup(pid: number, duty: string, dept: string, daytype: string, reason: string) {
    if (this.makeup.some((m) => m.person_id === pid && m.duty === duty && m.dept === dept && m.daytype === daytype)) return;
    this.makeup.push({ id: null, person_id: pid, duty, dept, daytype, reason, created: now() });
    this.makeupDirty = true;
  }
  removeMakeup(m: Makeup) {
    this.makeup = this.makeup.filter((x) => x !== m);
    this.makeupDirty = true;
  }
  unavailable(pid: number, date: string) {
    return this.unavail.find((u) => u.person_id === pid && u.start_date <= date && u.end_date >= date) ?? null;
  }

  // 이 칸에 배정하면 어기는 규칙(R2 휴가·출장, R4 같은 날 중복, R5 연속 근무)
  violations(pid: number, date: string, duty: string, dept = ''): string[] {
    const out: string[] = [];
    const u = this.unavailable(pid, date);
    if (u) out.push(u.kind);
    for (const [k, p] of this.sched.get(date) ?? []) {
      if (p === pid && k !== sk(duty, dept)) { out.push('같은 날 다른 근무'); break; }
    }
    if (DAILY_DUTIES.includes(duty) && this.setting('no_consecutive', true)) {
      const near = [addDays(date, -1), addDays(date, 1)].some((d) =>
        [...(this.sched.get(d) ?? [])].some(([k, p]) => p === pid && k.startsWith(duty + '|')));
      if (near) out.push('연속 근무');
    }
    return out;
  }

  // 보충 대기열 우선(R3), 그다음 순번에서 규칙을 지키는 첫 사람. 건너뛴 사람은 대기열에 올린다.
  pick(date: string, duty: string, dept = '', exclude = new Set<number>(), daytype?: string): number | null {
    const dtp = daytype ?? this.dayType(date);
    const valid = new Set(this.pool(duty, dept));
    for (const m of [...this.makeup]) {
      if (m.duty !== duty || m.dept !== dept || m.daytype !== dtp) continue;
      if (!valid.has(m.person_id)) { this.removeMakeup(m); continue; }
      if (exclude.has(m.person_id)) continue;
      if (!this.violations(m.person_id, date, duty, dept).length) {
        this.removeMakeup(m);
        return m.person_id;
      }
    }
    const [order, pos] = this.getRotation(duty, dept, dtp);
    const skipped: [number, string[]][] = [];
    for (let i = 0; i < order.length; i++) {
      const idx = (pos + i) % order.length;
      const pid = order[idx];
      if (exclude.has(pid)) continue;
      const v = this.violations(pid, date, duty, dept);
      if (v.length) { skipped.push([pid, v]); continue; }
      for (const [spid, sv] of skipped) this.addMakeup(spid, duty, dept, dtp, `${date} ${sv.join(', ')}(으)로 건너뜀`);
      this.saveRotation(duty, dept, dtp, order, (idx + 1) % order.length);
      return pid;
    }
    return null;
  }

  private dumpState(): Snapshot {
    return {
      rotations: [...this.rots].map(([key, r]) => ({ key, duty: r.duty, dept: r.dept, daytype: r.daytype, order_json: JSON.stringify(r.order), pos: r.pos })),
      makeup: this.makeup.filter((m) => m.id !== null).map((m) => ({ ...m })),
    };
  }
  private restoreState(s: Snapshot) {
    this.rots = new Map(s.rotations.map((r) => [r.key, { duty: r.duty, dept: r.dept, daytype: r.daytype, order: JSON.parse(r.order_json), pos: r.pos }]));
    this.makeup = s.makeup.map((m) => ({ ...m })) as Makeup[];
    this.rotsDirty = this.makeupDirty = true;
  }

  rotationOverview() {
    const keys: [string, string][] = [['dangjik', ''], ['iljik', ''], ...this.bisangDepts().map((d) => ['bisang', d] as [string, string])];
    const row = (duty: string, dept: string, dtp: string) => {
      const [order, pos] = this.getRotation(duty, dept, dtp);
      const next = Array.from({ length: Math.min(5, order.length) }, (_, i) => this.pname(order[(pos + i) % order.length]));
      return { duty, dept, daytype: dtp, label: slotLabel(duty, dept), daytype_label: DAYTYPE_LABEL[dtp], size: order.length, next };
    };
    return [...keys.flatMap(([d, dp]) => [row(d, dp, 'weekday'), row(d, dp, 'weekend')]), row('chachul', '', 'all')];
  }

  // ---------- 월 편성 (F1) ----------
  private checkNoLater(month: string) {
    const later = [...this.months.keys()].filter((m) => m > month).sort()[0];
    if (later) throw new ApiError(400, `${later} 편성이 이미 있어 ${month}은(는) 다시 편성할 수 없습니다. 이후 달 초안을 먼저 삭제하세요.`);
  }

  generateMonth(month: string, actor: string) {
    const dates = monthDates(month);
    const m = this.months.get(month);
    if (m?.status === 'confirmed') throw new ApiError(400, '이미 확정된 달입니다. 확정 후 변동은 휴가·출장 등록 또는 수동 수정으로 반영하세요.');
    this.checkNoLater(month);
    let snapshot: Snapshot;
    if (m) { snapshot = JSON.parse(m.snapshot); this.restoreState(snapshot); } else snapshot = this.dumpState();
    this.clearMonth(month);
    let unfilled = 0;
    for (const d of dates) {
      for (const [duty, dept] of this.dailySlots()) {
        const pid = this.pick(d, duty, dept);
        if (pid === null) unfilled++;
        this.set(d, duty, dept, pid);
      }
    }
    this.months.set(month, { status: 'draft', snapshot: JSON.stringify(snapshot), updated: now() });
    this.dirtyMonths.add(month);
    this.log(actor, `${month} 근무표`, '', '자동 편성(초안)', unfilled ? `미배정 ${unfilled}칸` : '');
    return { unfilled };
  }

  deleteMonth(month: string, actor: string) {
    const m = this.months.get(month);
    if (!m) throw new ApiError(404, '편성된 근무표가 없습니다.');
    if (m.status === 'confirmed') throw new ApiError(400, '확정된 근무표는 삭제할 수 없습니다.');
    this.checkNoLater(month);
    this.restoreState(JSON.parse(m.snapshot));
    this.clearMonth(month);
    this.months.delete(month);
    this.deletedMonths.add(month);
    this.log(actor, `${month} 근무표`, '초안', '삭제');
  }

  confirmMonth(month: string, actor: string, notify = true) {
    const m = this.months.get(month);
    if (m?.status !== 'draft') throw new ApiError(400, '초안 상태인 근무표만 확정할 수 있습니다.');
    m.status = 'confirmed';
    m.updated = now();
    this.dirtyMonths.add(month);
    this.log(actor, `${month} 근무표`, '초안', '확정');
    if (!notify) return;
    const mine = new Map<number, string[]>();
    for (const s of this.monthSlots(month)) {
      if (!s.person_id) continue;
      if (!mine.has(s.person_id)) mine.set(s.person_id, []);
      mine.get(s.person_id)!.push(`${fmtDate(s.date)} ${slotLabel(s.duty, s.dept)}`);
    }
    const [y, mo] = month.split('-');
    for (const [pid, items] of mine) {
      this.notify(pid, 'confirm', this.render('confirm', { name: this.pname(pid), date: `${Number(y)}년 ${Number(mo)}월`, detail: '내 근무: ' + items.join(', ') }), month);
    }
  }

  // D2·D8 검증: 규칙 위반 칸과 인원별 평일/주말 근무 횟수
  validateMonth(month: string) {
    monthDates(month);
    const issues: { slot: string; person: string; problems: string[] }[] = [];
    const counts = new Map<number, Record<string, number>>();
    for (const s of this.monthSlots(month)) {
      const label = `${fmtDate(s.date)} ${slotLabel(s.duty, s.dept)}`;
      if (!s.person_id) { issues.push({ slot: label, person: '-', problems: ['배정 가능 인원 없음'] }); continue; }
      const v = this.violations(s.person_id, s.date, s.duty, s.dept);
      if (v.length) issues.push({ slot: label, person: this.pname(s.person_id), problems: v });
      if (!counts.has(s.person_id)) counts.set(s.person_id, {});
      const c = counts.get(s.person_id)!;
      const key = `${s.duty}_${this.dayType(s.date)}`;
      c[key] = (c[key] ?? 0) + 1;
    }
    const table = [...counts].map(([pid, c]) => ({
      id: pid, name: this.pname(pid), dept: this.person(pid)?.dept ?? '', ...c,
      total: Object.values(c).reduce((a, b) => a + b, 0),
    })).sort((a, b) => a.id - b.id);
    return { issues, counts: table };
  }

  // ---------- 부분 재편성 (R6) ----------
  rescheduleUnavail(u: Row, actor: string) {
    this.unavail.push(u);
    const pid = u.person_id as number;
    const start = u.start_date > today() ? u.start_date : today();
    const changes: { slot: string; before: string; after: string }[] = [];
    const dates = [...this.sched.keys()].filter((d) => d >= start && d <= u.end_date).sort();
    for (const date of dates) {
      for (const s of this.slotsOn(date).filter((x) => x.person_id === pid)) {
        this.set(s.date, s.duty, s.dept, null);
        this.addMakeup(pid, s.duty, s.dept, this.dayType(s.date), `${u.kind}(${u.start_date}~${u.end_date})로 ${s.date} 근무 제외`);
        const fresh = this.pick(s.date, s.duty, s.dept, new Set([pid]));
        this.set(s.date, s.duty, s.dept, fresh);
        const label = `${fmtDate(s.date)} ${slotLabel(s.duty, s.dept)}`;
        this.log(actor, label, this.pname(pid), this.pname(fresh), `${u.kind} 등록에 따른 부분 재편성`);
        changes.push({ slot: label, before: this.pname(pid), after: this.pname(fresh) });
        if (this.monthStatus(s.date.slice(0, 7)) === 'confirmed') {
          this.notify(pid, 'change', this.render('change', { name: this.pname(pid), detail: `${label} 근무에서 제외되었습니다(${u.kind}). 복귀 후 보충 배정됩니다.` }));
          if (fresh) this.notify(fresh, 'change', this.render('change', { name: this.pname(fresh), detail: `${label} 근무가 새로 배정되었습니다.` }));
        }
      }
    }
    return changes;
  }

  // ---------- 수동 수정 ----------
  cellCandidates(date: string, duty: string, dept: string) {
    return this.pool(duty, dept).map((pid) => ({ id: pid, name: this.pname(pid), dept: this.person(pid)!.dept, problems: this.violations(pid, date, duty, dept) }));
  }

  setCell(actor: string, date: string, duty: string, dept: string, personId: number | null, reason: string, force: boolean) {
    const before = this.get(date, duty, dept);
    if (before === undefined) throw new ApiError(404, '편성되지 않은 칸입니다.');
    if (personId === before) return { ok: true };
    if (personId) {
      if (!this.pool(duty, dept).includes(personId)) throw new ApiError(400, '해당 근무 대상자가 아닙니다.');
      const v = this.violations(personId, date, duty, dept);
      if (v.length && !force) return { warnings: v };
    }
    this.set(date, duty, dept, personId);
    const label = `${fmtDate(date)} ${slotLabel(duty, dept)}`;
    this.log(actor, label, this.pname(before), this.pname(personId), reason || '수동 수정');
    if (this.monthStatus(date.slice(0, 7)) === 'confirmed') {
      if (before) this.notify(before, 'change', this.render('change', { name: this.pname(before), detail: `${label} 근무에서 제외되었습니다.` }));
      if (personId) this.notify(personId, 'change', this.render('change', { name: this.pname(personId), detail: `${label} 근무가 배정되었습니다.` }));
    }
    return { ok: true };
  }

  // ---------- 차출 ----------
  drawPick(count: number) {
    if (!Number.isInteger(count) || count < 1) throw new ApiError(400, '인원 수는 1명 이상이어야 합니다.');
    const chosen: number[] = [];
    for (let i = 0; i < count; i++) {
      const pid = this.pick(today(), 'chachul', '', new Set(chosen), 'all');
      if (pid === null) break;
      chosen.push(pid);
    }
    if (!chosen.length) throw new ApiError(400, '선발 가능한 인원이 없습니다.');
    return chosen;
  }

  // ---------- 교대 (F2) ----------
  confirmedSlot(date: string, duty: string, dept: string) {
    const pid = this.get(date, duty, dept);
    if (pid === undefined || this.monthStatus(date.slice(0, 7)) !== 'confirmed') throw new ApiError(400, '확정된 근무표의 근무만 교대할 수 있습니다.');
    if (date < today()) throw new ApiError(400, '지난 근무는 교대할 수 없습니다.');
    return pid;
  }

  swapCandidates(meId: number, date: string, duty: string, dept: string) {
    if (this.confirmedSlot(date, duty, dept) !== meId) throw new ApiError(403, '본인 근무만 교대 요청할 수 있습니다.');
    const t = today();
    return this.pool(duty, dept).filter((pid) => pid !== meId).map((pid) => ({
      id: pid, name: this.pname(pid), dept: this.person(pid)!.dept, problems: this.violations(pid, date, duty, dept),
      dates: [...this.sched.keys()].filter((d) => d >= t && this.monthStatus(d.slice(0, 7)) === 'confirmed' && this.get(d, duty, dept) === pid).sort(),
    }));
  }

  checkSwapRequest(meId: number, date: string, duty: string, dept: string, target: number, targetDate: string | null) {
    if (this.confirmedSlot(date, duty, dept) !== meId) throw new ApiError(403, '본인 근무만 교대 요청할 수 있습니다.');
    if (target === meId || !this.pool(duty, dept).includes(target)) throw new ApiError(400, '같은 근무 종류 대상자에게만 교대를 요청할 수 있습니다.');
    if (targetDate && this.confirmedSlot(targetDate, duty, dept) !== target) throw new ApiError(400, '상대방의 해당 날짜 근무를 찾을 수 없습니다.');
  }

  applySwap(s: Row, actorId: number) {
    const { duty, dept } = s;
    if (this.confirmedSlot(s.date, duty, dept) !== s.requester) throw new ApiError(400, '요청 이후 근무표가 바뀌어 처리할 수 없습니다.');
    if (s.target_date && this.confirmedSlot(s.target_date, duty, dept) !== s.target) throw new ApiError(400, '요청 이후 근무표가 바뀌어 처리할 수 없습니다.');
    this.set(s.date, duty, dept, s.target);
    if (s.target_date) this.set(s.target_date, duty, dept, s.requester);
    const problems = [...this.violations(s.target, s.date, duty, dept), ...(s.target_date ? this.violations(s.requester, s.target_date, duty, dept) : [])];
    if (problems.length) throw new ApiError(400, '규칙 위반으로 교대할 수 없습니다: ' + [...new Set(problems)].join(', '));
    const actor = this.pname(actorId);
    const l1 = `${fmtDate(s.date)} ${slotLabel(duty, dept)}`;
    this.log(actor, l1, this.pname(s.requester), this.pname(s.target), `교대 #${s.id} 수락`);
    let detail = `${l1}: ${this.pname(s.requester)} → ${this.pname(s.target)}`;
    if (s.target_date) {
      const l2 = `${fmtDate(s.target_date)} ${slotLabel(duty, dept)}`;
      this.log(actor, l2, this.pname(s.target), this.pname(s.requester), `교대 #${s.id} 수락(맞교대)`);
      detail += ` / ${l2}: ${this.pname(s.target)} → ${this.pname(s.requester)}`;
    }
    for (const pid of new Set([s.requester, s.target, ...this.admins()])) {
      this.notify(pid, 'swap_done', this.render('swap_done', { name: this.pname(pid), detail }), `swap${s.id}`);
    }
  }

  // ---------- 전날 알림 (F3) ----------
  // sentRefs: 이미 보낸 전날 알림 '참조#인원#경로' 모음
  reminders(target: string, sentRefs: Set<string>) {
    return this.slotsOn(target).filter((s) => s.person_id).map((s) => {
      const ref = `${target}|${s.duty}|${s.dept}`;
      const sent = Object.fromEntries(Object.keys(CHANNELS).map((ch) => [ch, sentRefs.has(`${ref}#${s.person_id}#${ch}`)]));
      return {
        slot: s, ref, sent, person: this.pname(s.person_id),
        label: slotLabel(s.duty, s.dept),
        content: this.render('reminder', { name: this.pname(s.person_id), date: fmtDate(target), duty: slotLabel(s.duty, s.dept) }),
      };
    });
  }

  runDaily(target: string, timeStr: string, sentRefs: Set<string>, channels = Object.keys(CHANNELS)) {
    if (this.monthStatus(target.slice(0, 7)) !== 'confirmed') return 0;
    let sent = 0;
    for (const r of this.reminders(target, sentRefs)) {
      const todo = channels.filter((ch) => !r.sent[ch]);
      if (!todo.length) continue;
      this.notify(r.slot.person_id!, 'reminder', r.content, r.ref, `${addDays(target, -1)} ${timeStr}`, todo);
      sent++;
    }
    return sent;
  }

  // ---------- 저장 ----------
  async flush(db: Tx) {
    for (const m of this.clearedMonths) await db.ex('DELETE FROM schedule WHERE date LIKE $1', [m + '-%']);
    const slots: unknown[][] = [];
    for (const key of this.dirtySlots) {
      const [date, duty, dept] = key.split('|');
      const pid = this.get(date, duty, dept);
      if (pid !== undefined) slots.push([date, duty, dept, pid]);
    }
    await insertMany(db, 'schedule', ['date', 'duty', 'dept', 'person_id'], slots,
      'ON CONFLICT(date, duty, dept) DO UPDATE SET person_id=EXCLUDED.person_id');
    if (this.rotsDirty) {
      await db.ex('DELETE FROM rotations');
      await insertMany(db, 'rotations', ['key', 'duty', 'dept', 'daytype', 'order_json', 'pos'],
        [...this.rots].map(([k, r]) => [k, r.duty, r.dept, r.daytype, JSON.stringify(r.order), r.pos]));
    }
    if (this.makeupDirty) {
      await db.ex('DELETE FROM makeup');
      const cols = ['person_id', 'duty', 'dept', 'daytype', 'reason', 'created'];
      const vals = (m: Makeup) => [m.person_id, m.duty, m.dept, m.daytype, m.reason, m.created];
      await insertMany(db, 'makeup', ['id', ...cols], this.makeup.filter((m) => m.id !== null).map((m) => [m.id, ...vals(m)]));
      await insertMany(db, 'makeup', cols, this.makeup.filter((m) => m.id === null).map(vals));
    }
    for (const m of this.deletedMonths) await db.ex('DELETE FROM months WHERE month=$1', [m]);
    for (const k of this.dirtyMonths) {
      const m = this.months.get(k);
      if (!m) continue;
      await db.ex('INSERT INTO months(month, status, snapshot, updated) VALUES($1,$2,$3,$4) ON CONFLICT(month) DO UPDATE SET status=EXCLUDED.status, updated=EXCLUDED.updated',
        [k, m.status, m.snapshot, m.updated]);
    }
    for (const k of this.dirtySettings) {
      await db.ex('INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [k, JSON.stringify(this.settings.get(k))]);
    }
    await insertMany(db, 'changelog', ['ts', 'actor', 'target', 'before', 'after', 'reason'], this.logs);
    const rows: unknown[][] = [];
    for (const n of this.notes) {
      for (const ch of n.channels) {
        const d = await deliver(this.person(n.pid), ch, n.content);
        const ts = now();
        rows.push([n.pid, ch, n.kind, n.content, n.ref, n.scheduledAt ?? ts, ts, ts, d.result, d.error, d.note, 1]);
      }
    }
    await insertMany(db, 'notifications', ['person_id', 'channel', 'kind', 'content', 'ref', 'scheduled_at', 'created', 'sent_at', 'result', 'error', 'note', 'attempts'], rows);
  }
}
