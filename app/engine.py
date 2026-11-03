"""편성 엔진: 순번(평일/주말 분리), 보충 대기열, 규칙 R1~R7, 교대, 차출, 알림 생성."""
import calendar
import datetime as dt
import json

from .common import ApiError, add_days, fmt_date, now, parse_date, today

DUTY_LABEL = {'dangjik': '당직사관', 'iljik': '일직사관', 'bisang': '비상대기', 'chachul': '차출'}
DAILY_DUTIES = ('dangjik', 'iljik', 'bisang')
DAYTYPE_LABEL = {'weekday': '평일', 'weekend': '주말·공휴일', 'all': '전체'}
UNAVAIL_KINDS = ('휴가', '출장')


# ---------- 기본 조회 ----------

def slot_label(duty, dept=''):
    return f'{DUTY_LABEL[duty]}({dept})' if duty == 'bisang' and dept else DUTY_LABEL[duty]


def person(db, pid):
    return db.q1('SELECT * FROM people WHERE id=?', (pid,)) if pid else None


def pname(db, pid):
    p = person(db, pid)
    return f"{p['rank']} {p['name']}".strip() if p else '(미배정)'


def duties_of(p):
    return [d for d in (p.get('duties') or '').split(',') if d]


def month_dates(month):
    try:
        y, m = map(int, month.split('-'))
        n = calendar.monthrange(y, m)[1]
    except (ValueError, AttributeError):
        raise ApiError(400, f'월 형식이 올바르지 않습니다: {month}')
    return [dt.date(y, m, d).isoformat() for d in range(1, n + 1)]


def holiday(db, date):
    r = db.q1('SELECT name FROM holidays WHERE date=?', (date,))
    return r['name'] if r else None


def day_type(db, date):
    return 'weekend' if parse_date(date).weekday() >= 5 or holiday(db, date) else 'weekday'


def bisang_depts(db):
    rows = db.q('SELECT dept, duties FROM people WHERE active=1')
    return sorted({r['dept'] for r in rows if 'bisang' in duties_of(r) and r['dept']})


def daily_slots(db):
    return [('dangjik', ''), ('iljik', '')] + [('bisang', d) for d in bisang_depts(db)]


def month_status(db, month):
    r = db.q1('SELECT status FROM months WHERE month=?', (month,))
    return r['status'] if r else None


def admins(db):
    return [r['id'] for r in db.q('SELECT id FROM people WHERE is_admin=1 AND active=1')]


def log_change(db, actor, target, before, after, reason=''):
    db.ex('INSERT INTO changelog(ts, actor, target, before, after, reason) VALUES(?,?,?,?,?,?)',
          (now(), actor, target, before, after, reason))


# ---------- 순번 / 보충 대기열 ----------

def pool(db, duty, dept=''):
    rows = db.q('SELECT id, dept, duties FROM people WHERE active=1 ORDER BY id')
    return [r['id'] for r in rows
            if duty in duties_of(r) and (duty != 'bisang' or r['dept'] == dept)]


def rot_key(duty, dept, daytype):
    return f'{duty}|{dept}|{daytype}'


def get_rotation(db, duty, dept, daytype):
    """저장된 순서를 현재 인원과 맞춘다(퇴출 인원 제거, 신규 인원 뒤에 추가)."""
    ids = pool(db, duty, dept)
    r = db.q1('SELECT * FROM rotations WHERE key=?', (rot_key(duty, dept, daytype),))
    if not r:
        return ids, 0
    order, pos = json.loads(r['order_json']), r['pos']
    new = [i for i in order if i in ids] + [i for i in ids if i not in order]
    remaining = [i for i in order[pos:] if i in new] if 0 <= pos < len(order) else []
    pos = new.index(remaining[0]) if remaining else 0
    return new, pos


def save_rotation(db, duty, dept, daytype, order, pos):
    db.ex('INSERT INTO rotations(key, duty, dept, daytype, order_json, pos) VALUES(?,?,?,?,?,?) '
          'ON CONFLICT(key) DO UPDATE SET order_json=excluded.order_json, pos=excluded.pos',
          (rot_key(duty, dept, daytype), duty, dept, daytype, json.dumps(order), pos))


def add_makeup(db, pid, duty, dept, daytype, reason):
    if db.q1('SELECT 1 FROM makeup WHERE person_id=? AND duty=? AND dept=? AND daytype=?',
             (pid, duty, dept, daytype)):
        return
    db.ex('INSERT INTO makeup(person_id, duty, dept, daytype, reason, created) VALUES(?,?,?,?,?,?)',
          (pid, duty, dept, daytype, reason, now()))


def unavailable(db, pid, date):
    return db.q1('SELECT * FROM unavail WHERE person_id=? AND start<=? AND end>=?', (pid, date, date))


def violations(db, pid, date, duty, dept=''):
    """해당 인원을 이 칸에 배정하면 어기는 규칙 목록(R2, R4, R5)."""
    out = []
    u = unavailable(db, pid, date)
    if u:
        out.append(u['kind'])
    if db.q1('SELECT 1 FROM schedule WHERE date=? AND person_id=? AND NOT (duty=? AND dept=?)',
             (date, pid, duty, dept)):
        out.append('같은 날 다른 근무')
    if duty in DAILY_DUTIES and db.get_setting('no_consecutive', True):
        if db.q1('SELECT 1 FROM schedule WHERE person_id=? AND duty=? AND date IN (?, ?)',
                 (pid, duty, add_days(date, -1), add_days(date, 1))):
            out.append('연속 근무')
    return out


def pick(db, date, duty, dept='', exclude=(), daytype=None):
    """보충 대기열 우선(R3), 그다음 순번에서 규칙을 지키는 첫 사람. 건너뛴 사람은 대기열에 올린다."""
    dtp = daytype or day_type(db, date)
    valid = set(pool(db, duty, dept))
    for m in db.q('SELECT * FROM makeup WHERE duty=? AND dept=? AND daytype=? ORDER BY id', (duty, dept, dtp)):
        pid = m['person_id']
        if pid not in valid:
            db.ex('DELETE FROM makeup WHERE id=?', (m['id'],))
            continue
        if pid in exclude:
            continue
        if not violations(db, pid, date, duty, dept):
            db.ex('DELETE FROM makeup WHERE id=?', (m['id'],))
            return pid
    order, pos = get_rotation(db, duty, dept, dtp)
    skipped = []
    for i in range(len(order)):
        idx = (pos + i) % len(order)
        pid = order[idx]
        if pid in exclude:
            continue
        v = violations(db, pid, date, duty, dept)
        if v:
            skipped.append((pid, v))
            continue
        for spid, sv in skipped:
            add_makeup(db, spid, duty, dept, dtp, f"{date} {', '.join(sv)}(으)로 건너뜀")
        save_rotation(db, duty, dept, dtp, order, (idx + 1) % len(order))
        return pid
    return None


def dump_state(db):
    return {'rotations': db.q('SELECT * FROM rotations'), 'makeup': db.q('SELECT * FROM makeup')}


def restore_state(db, state):
    db.ex('DELETE FROM rotations')
    db.ex('DELETE FROM makeup')
    for r in state['rotations']:
        db.ex('INSERT INTO rotations(key, duty, dept, daytype, order_json, pos) VALUES(?,?,?,?,?,?)',
              (r['key'], r['duty'], r['dept'], r['daytype'], r['order_json'], r['pos']))
    for m in state['makeup']:
        db.ex('INSERT INTO makeup(id, person_id, duty, dept, daytype, reason, created) VALUES(?,?,?,?,?,?,?)',
              (m['id'], m['person_id'], m['duty'], m['dept'], m['daytype'], m['reason'], m['created']))


def rotation_overview(db):
    out = []
    keys = [(d, '') for d in ('dangjik', 'iljik')] + [('bisang', dp) for dp in bisang_depts(db)]
    for duty, dept in keys:
        for dtp in ('weekday', 'weekend'):
            out.append(_rot_row(db, duty, dept, dtp))
    out.append(_rot_row(db, 'chachul', '', 'all'))
    return out


def _rot_row(db, duty, dept, dtp):
    order, pos = get_rotation(db, duty, dept, dtp)
    upcoming = [pname(db, order[(pos + i) % len(order)]) for i in range(min(5, len(order)))]
    return {'duty': duty, 'dept': dept, 'daytype': dtp, 'label': slot_label(duty, dept),
            'daytype_label': DAYTYPE_LABEL[dtp], 'size': len(order), 'next': upcoming}


# ---------- 월 편성 (F1) ----------

def _check_no_later(db, month):
    later = db.q1('SELECT month FROM months WHERE month>? ORDER BY month LIMIT 1', (month,))
    if later:
        raise ApiError(400, f"{later['month']} 편성이 이미 있어 {month}은(는) 다시 편성할 수 없습니다. 이후 달 초안을 먼저 삭제하세요.")


def generate_month(db, month, actor):
    dates = month_dates(month)
    m = db.q1('SELECT * FROM months WHERE month=?', (month,))
    if m and m['status'] == 'confirmed':
        raise ApiError(400, '이미 확정된 달입니다. 확정 후 변동은 휴가·출장 등록 또는 수동 수정으로 반영하세요.')
    _check_no_later(db, month)
    if m:
        snapshot = json.loads(m['snapshot'])
        restore_state(db, snapshot)
    else:
        snapshot = dump_state(db)
    db.ex('DELETE FROM schedule WHERE date LIKE ?', (month + '-%',))
    unfilled = 0
    for d in dates:
        for duty, dept in daily_slots(db):
            pid = pick(db, d, duty, dept)
            unfilled += pid is None
            db.ex('INSERT INTO schedule(date, duty, dept, person_id) VALUES(?,?,?,?)', (d, duty, dept, pid))
    db.ex('INSERT INTO months(month, status, snapshot, updated) VALUES(?,?,?,?) '
          'ON CONFLICT(month) DO UPDATE SET status=excluded.status, updated=excluded.updated',
          (month, 'draft', json.dumps(snapshot), now()))
    log_change(db, actor, f'{month} 근무표', '', '자동 편성(초안)', f'미배정 {unfilled}칸' if unfilled else '')
    return {'unfilled': unfilled}


def delete_month(db, month, actor):
    m = db.q1('SELECT * FROM months WHERE month=?', (month,))
    if not m:
        raise ApiError(404, '편성된 근무표가 없습니다.')
    if m['status'] == 'confirmed':
        raise ApiError(400, '확정된 근무표는 삭제할 수 없습니다.')
    _check_no_later(db, month)
    restore_state(db, json.loads(m['snapshot']))
    db.ex('DELETE FROM schedule WHERE date LIKE ?', (month + '-%',))
    db.ex('DELETE FROM months WHERE month=?', (month,))
    log_change(db, actor, f'{month} 근무표', '초안', '삭제')


def confirm_month(db, nt, month, actor):
    if month_status(db, month) != 'draft':
        raise ApiError(400, '초안 상태인 근무표만 확정할 수 있습니다.')
    db.ex("UPDATE months SET status='confirmed', updated=? WHERE month=?", (now(), month))
    log_change(db, actor, f'{month} 근무표', '초안', '확정')
    if nt:
        rows = db.q('SELECT * FROM schedule WHERE date LIKE ? AND person_id IS NOT NULL ORDER BY date', (month + '-%',))
        mine = {}
        for r in rows:
            mine.setdefault(r['person_id'], []).append(f"{fmt_date(r['date'])} {slot_label(r['duty'], r['dept'])}")
        y, mo = month.split('-')
        for pid, items in mine.items():
            nt.send(db, pid, 'confirm', nt.render(db, 'confirm', name=pname(db, pid), date=f'{int(y)}년 {int(mo)}월',
                                                  detail='내 근무: ' + ', '.join(items)), ref=month)


def validate_month(db, month):
    """D2·D8 검증: 규칙 위반 칸과 인원별 평일/주말 근무 횟수."""
    issues, counts = [], {}
    for r in db.q('SELECT * FROM schedule WHERE date LIKE ? ORDER BY date, duty, dept', (month + '-%',)):
        label = f"{fmt_date(r['date'])} {slot_label(r['duty'], r['dept'])}"
        if not r['person_id']:
            issues.append({'slot': label, 'person': '-', 'problems': ['배정 가능 인원 없음']})
            continue
        v = violations(db, r['person_id'], r['date'], r['duty'], r['dept'])
        if v:
            issues.append({'slot': label, 'person': pname(db, r['person_id']), 'problems': v})
        c = counts.setdefault(r['person_id'], {})
        key = f"{r['duty']}_{day_type(db, r['date'])}"
        c[key] = c.get(key, 0) + 1
    table = []
    for pid, c in counts.items():
        p = person(db, pid)
        table.append({'id': pid, 'name': pname(db, pid), 'dept': p['dept'] if p else '', **c,
                      'total': sum(c.values())})
    table.sort(key=lambda x: x['id'])
    return {'issues': issues, 'counts': table}


# ---------- 부분 재편성 (R6) ----------

def reschedule_unavail(db, nt, uid, actor):
    u = db.q1('SELECT * FROM unavail WHERE id=?', (uid,))
    pid = u['person_id']
    start = max(u['start'], today())
    rows = db.q('SELECT * FROM schedule WHERE person_id=? AND date BETWEEN ? AND ? ORDER BY date',
                (pid, start, u['end']))
    changes = []
    for r in rows:
        dtp = day_type(db, r['date'])
        key = (r['date'], r['duty'], r['dept'])
        db.ex('UPDATE schedule SET person_id=NULL WHERE date=? AND duty=? AND dept=?', key)
        add_makeup(db, pid, r['duty'], r['dept'], dtp,
                   f"{u['kind']}({u['start']}~{u['end']})로 {r['date']} 근무 제외")
        new = pick(db, r['date'], r['duty'], r['dept'], exclude={pid})
        db.ex('UPDATE schedule SET person_id=? WHERE date=? AND duty=? AND dept=?', (new,) + key)
        label = f"{fmt_date(r['date'])} {slot_label(r['duty'], r['dept'])}"
        log_change(db, actor, label, pname(db, pid), pname(db, new), f"{u['kind']} 등록에 따른 부분 재편성")
        changes.append({'slot': label, 'before': pname(db, pid), 'after': pname(db, new)})
        if nt and month_status(db, r['date'][:7]) == 'confirmed':
            nt.send(db, pid, 'change', nt.render(db, 'change', name=pname(db, pid),
                    detail=f"{label} 근무에서 제외되었습니다({u['kind']}). 복귀 후 보충 배정됩니다."))
            if new:
                nt.send(db, new, 'change', nt.render(db, 'change', name=pname(db, new),
                        detail=f'{label} 근무가 새로 배정되었습니다.'))
    return changes


# ---------- 수동 수정 ----------

def cell_candidates(db, date, duty, dept):
    out = []
    for pid in pool(db, duty, dept):
        p = person(db, pid)
        out.append({'id': pid, 'name': pname(db, pid), 'dept': p['dept'],
                    'problems': violations(db, pid, date, duty, dept)})
    return out


def set_cell(db, nt, actor, date, duty, dept, person_id, reason, force=False):
    slot = db.q1('SELECT * FROM schedule WHERE date=? AND duty=? AND dept=?', (date, duty, dept))
    if not slot:
        raise ApiError(404, '편성되지 않은 칸입니다.')
    person_id = int(person_id) if person_id else None
    if person_id == slot['person_id']:
        return {'ok': True}
    if person_id:
        if person_id not in pool(db, duty, dept):
            raise ApiError(400, '해당 근무 대상자가 아닙니다.')
        v = violations(db, person_id, date, duty, dept)
        if v and not force:
            return {'warnings': v}
    before = slot['person_id']
    db.ex('UPDATE schedule SET person_id=? WHERE date=? AND duty=? AND dept=?', (person_id, date, duty, dept))
    label = f'{fmt_date(date)} {slot_label(duty, dept)}'
    log_change(db, actor, label, pname(db, before), pname(db, person_id), reason or '수동 수정')
    if nt and month_status(db, date[:7]) == 'confirmed':
        if before:
            nt.send(db, before, 'change', nt.render(db, 'change', name=pname(db, before),
                    detail=f'{label} 근무에서 제외되었습니다.'))
        if person_id:
            nt.send(db, person_id, 'change', nt.render(db, 'change', name=pname(db, person_id),
                    detail=f'{label} 근무가 배정되었습니다.'))
    return {'ok': True}


# ---------- 차출 ----------

def draw(db, nt, count, memo, actor):
    if count < 1:
        raise ApiError(400, '인원 수는 1명 이상이어야 합니다.')
    t, chosen = today(), []
    for _ in range(count):
        pid = pick(db, t, 'chachul', '', exclude=set(chosen), daytype='all')
        if pid is None:
            break
        chosen.append(pid)
    if not chosen:
        raise ApiError(400, '선발 가능한 인원이 없습니다.')
    did = db.ex('INSERT INTO draws(created, count, person_ids, memo, actor) VALUES(?,?,?,?,?)',
                (now(), count, json.dumps(chosen), memo, actor))
    names = ', '.join(pname(db, p) for p in chosen)
    log_change(db, actor, f'차출 #{did}', f'요청 {count}명', names, memo)
    for pid in chosen:
        nt.send(db, pid, 'draw', nt.render(db, 'draw', name=pname(db, pid), detail=memo or ''), ref=f'draw{did}')
    return {'id': did, 'chosen': [pname(db, p) for p in chosen], 'short': count - len(chosen)}


# ---------- 교대 (F2) ----------

def _confirmed_slot(db, date, duty, dept):
    s = db.q1('SELECT * FROM schedule WHERE date=? AND duty=? AND dept=?', (date, duty, dept))
    if not s or month_status(db, date[:7]) != 'confirmed':
        raise ApiError(400, '확정된 근무표의 근무만 교대할 수 있습니다.')
    if date < today():
        raise ApiError(400, '지난 근무는 교대할 수 없습니다.')
    return s


def swap_candidates(db, me, date, duty, dept):
    s = _confirmed_slot(db, date, duty, dept)
    if s['person_id'] != me['id']:
        raise ApiError(403, '본인 근무만 교대 요청할 수 있습니다.')
    out = []
    for pid in pool(db, duty, dept):
        if pid == me['id']:
            continue
        p = person(db, pid)
        future = db.q("SELECT s.date FROM schedule s JOIN months m ON m.month=substr(s.date,1,7) "
                      "WHERE s.person_id=? AND s.duty=? AND s.dept=? AND s.date>=? AND m.status='confirmed' "
                      "ORDER BY s.date", (pid, duty, dept, today()))
        out.append({'id': pid, 'name': pname(db, pid), 'dept': p['dept'],
                    'problems': violations(db, pid, date, duty, dept),
                    'dates': [f['date'] for f in future]})
    return out


def create_swap(db, nt, me, date, duty, dept, target, target_date, memo):
    s = _confirmed_slot(db, date, duty, dept)
    if s['person_id'] != me['id']:
        raise ApiError(403, '본인 근무만 교대 요청할 수 있습니다.')
    target = int(target)
    if target == me['id'] or target not in pool(db, duty, dept):
        raise ApiError(400, '같은 근무 종류 대상자에게만 교대를 요청할 수 있습니다.')
    if target_date:
        s2 = _confirmed_slot(db, target_date, duty, dept)
        if s2['person_id'] != target:
            raise ApiError(400, '상대방의 해당 날짜 근무를 찾을 수 없습니다.')
    if db.q1("SELECT 1 FROM swaps WHERE date=? AND duty=? AND dept=? AND status='pending'", (date, duty, dept)):
        raise ApiError(400, '이 근무에 대해 처리 대기 중인 교대 요청이 이미 있습니다.')
    sid = db.ex('INSERT INTO swaps(requester, target, date, duty, dept, target_date, status, memo, created) '
                'VALUES(?,?,?,?,?,?,?,?,?)',
                (me['id'], target, date, duty, dept, target_date or None, 'pending', memo, now()))
    detail = f"{pname(db, me['id'])}님이 {fmt_date(date)} {slot_label(duty, dept)} 교대를 요청했습니다."
    if target_date:
        detail += f' (맞교대: 귀하의 {fmt_date(target_date)} 근무)'
    nt.send(db, target, 'swap_request', nt.render(db, 'swap_request', name=pname(db, target), detail=detail),
            ref=f'swap{sid}')
    return sid


def _get_swap(db, sid):
    s = db.q1('SELECT * FROM swaps WHERE id=?', (sid,))
    if not s:
        raise ApiError(404, '교대 요청을 찾을 수 없습니다.')
    if s['status'] != 'pending':
        raise ApiError(400, '이미 처리된 요청입니다.')
    return s


def accept_swap(db, nt, me, sid):
    s = _get_swap(db, sid)
    if s['target'] != me['id']:
        raise ApiError(403, '본인에게 온 요청만 수락할 수 있습니다.')
    duty, dept = s['duty'], s['dept']
    k1 = (s['date'], duty, dept)
    slot1 = _confirmed_slot(db, *k1)
    if slot1['person_id'] != s['requester']:
        raise ApiError(400, '요청 이후 근무표가 바뀌어 처리할 수 없습니다.')
    k2 = (s['target_date'], duty, dept) if s['target_date'] else None
    if k2 and _confirmed_slot(db, *k2)['person_id'] != s['target']:
        raise ApiError(400, '요청 이후 근무표가 바뀌어 처리할 수 없습니다.')
    db.ex('UPDATE schedule SET person_id=? WHERE date=? AND duty=? AND dept=?', (s['target'],) + k1)
    if k2:
        db.ex('UPDATE schedule SET person_id=? WHERE date=? AND duty=? AND dept=?', (s['requester'],) + k2)
    problems = violations(db, s['target'], *k1)
    if k2:
        problems += violations(db, s['requester'], *k2)
    if problems:
        db.ex('UPDATE schedule SET person_id=? WHERE date=? AND duty=? AND dept=?', (s['requester'],) + k1)
        if k2:
            db.ex('UPDATE schedule SET person_id=? WHERE date=? AND duty=? AND dept=?', (s['target'],) + k2)
        raise ApiError(400, '규칙 위반으로 교대할 수 없습니다: ' + ', '.join(sorted(set(problems))))
    db.ex("UPDATE swaps SET status='accepted', processed=? WHERE id=?", (now(), sid))
    actor = pname(db, me['id'])
    l1 = f'{fmt_date(s["date"])} {slot_label(duty, dept)}'
    log_change(db, actor, l1, pname(db, s['requester']), pname(db, s['target']), f'교대 #{sid} 수락')
    detail = f"{l1}: {pname(db, s['requester'])} → {pname(db, s['target'])}"
    if k2:
        l2 = f'{fmt_date(s["target_date"])} {slot_label(duty, dept)}'
        log_change(db, actor, l2, pname(db, s['target']), pname(db, s['requester']), f'교대 #{sid} 수락(맞교대)')
        detail += f" / {l2}: {pname(db, s['target'])} → {pname(db, s['requester'])}"
    for pid in dict.fromkeys([s['requester'], s['target']] + admins(db)):
        nt.send(db, pid, 'swap_done', nt.render(db, 'swap_done', name=pname(db, pid), detail=detail), ref=f'swap{sid}')


def close_swap(db, me, sid, action):
    s = _get_swap(db, sid)
    if action == 'reject' and s['target'] != me['id']:
        raise ApiError(403, '본인에게 온 요청만 거절할 수 있습니다.')
    if action == 'cancel' and s['requester'] != me['id']:
        raise ApiError(403, '본인이 보낸 요청만 취소할 수 있습니다.')
    db.ex('UPDATE swaps SET status=?, processed=? WHERE id=?',
          ('rejected' if action == 'reject' else 'cancelled', now(), sid))


def swap_row(db, s):
    return {**s, 'requester_name': pname(db, s['requester']), 'target_name': pname(db, s['target']),
            'label': slot_label(s['duty'], s['dept'])}


# ---------- 전날 알림 (F3) ----------

def run_daily(db, nt, target_date, time_str):
    rows = db.q('SELECT * FROM schedule WHERE date=? AND person_id IS NOT NULL', (target_date,))
    if month_status(db, target_date[:7]) != 'confirmed':
        return 0
    sent = 0
    for r in rows:
        ref = f"{target_date}|{r['duty']}|{r['dept']}"
        if db.q1("SELECT 1 FROM notifications WHERE kind='reminder' AND ref=? AND person_id=?", (ref, r['person_id'])):
            continue
        content = nt.render(db, 'reminder', name=pname(db, r['person_id']), date=fmt_date(target_date),
                            duty=slot_label(r['duty'], r['dept']))
        nt.send(db, r['person_id'], 'reminder', content, ref=ref,
                scheduled_at=f'{add_days(target_date, -1)} {time_str}')
        sent += 1
    return sent


def maybe_run_daily(db, nt, config):
    time_str = config.get('daily_notify_time', '17:00')
    h, m = map(int, time_str.split(':'))
    n = dt.datetime.now()
    if (n.hour, n.minute) >= (h, m) and db.get_setting('last_daily_run') != today():
        run_daily(db, nt, add_days(today(), 1), time_str)
        db.set_setting('last_daily_run', today())


def upcoming(db, nt, config):
    target = add_days(today(), 1)
    time_str = config.get('daily_notify_time', '17:00')
    confirmed = month_status(db, target[:7]) == 'confirmed'
    out = []
    for r in db.q('SELECT * FROM schedule WHERE date=? AND person_id IS NOT NULL ORDER BY duty, dept', (target,)):
        ref = f"{target}|{r['duty']}|{r['dept']}"
        done = bool(db.q1("SELECT 1 FROM notifications WHERE kind='reminder' AND ref=? AND person_id=?",
                          (ref, r['person_id'])))
        out.append({'person': pname(db, r['person_id']), 'slot': slot_label(r['duty'], r['dept']),
                    'content': nt.render(db, 'reminder', name=pname(db, r['person_id']),
                                         date=fmt_date(target), duty=slot_label(r['duty'], r['dept'])),
                    'sent': done})
    return {'date': target, 'scheduled_at': f'{today()} {time_str}', 'confirmed': confirmed, 'items': out}
