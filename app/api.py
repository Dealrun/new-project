"""HTTP API 라우트. 모든 핸들러는 서버의 전역 잠금 안에서 실행된다."""
import json
import re

from . import engine as E
from .common import ApiError, now, today
from .notifier import CHANNELS, DEFAULT_TEMPLATES, TEMPLATE_LABELS

ROUTES = []


def route(method, pattern, admin=False, public=False):
    def deco(fn):
        ROUTES.append((method, re.compile('^/api' + pattern + '$'), fn, admin, public))
        return fn
    return deco


class Ctx:
    def __init__(self, db, config, notifier, auth, query, token):
        self.db, self.config, self.nt, self.auth = db, config, notifier, auth
        self.query, self.token = query, token
        self.user = None
        self.cookies = []

    def arg(self, name, default=None):
        return self.query.get(name, [default])[0]

    @property
    def actor(self):
        return E.pname(self.db, self.user['id']) if self.user else '시스템'


def dispatch(method, path, ctx, body):
    for m, rx, fn, admin, public in ROUTES:
        if m != method:
            continue
        mt = rx.match(path)
        if not mt:
            continue
        if not public:
            ctx.user = ctx.auth.user(ctx.db, ctx.token)
            if not ctx.user:
                raise ApiError(401, '로그인이 필요합니다.')
            if admin and not ctx.user['is_admin']:
                raise ApiError(403, '편성 담당 간부만 사용할 수 있습니다.')
        return fn(ctx, body, *mt.groups())
    raise ApiError(404, '없는 API입니다.')


def mask_phone(phone):
    return ('***-****-' + phone[-4:]) if phone else ''


def person_out(p, admin=False):
    d = {'id': p['id'], 'name': p['name'], 'rank': p['rank'], 'dept': p['dept'],
         'duties': E.duties_of(p), 'active': p['active'], 'is_admin': p['is_admin']}
    if admin:
        d.update(login_id=p['login_id'], email=p['email'], phone_masked=mask_phone(p['phone']))
    return d


def log_access(ctx, pid, field, purpose):
    ctx.db.ex('INSERT INTO access_log(ts, actor, person_id, field, purpose) VALUES(?,?,?,?,?)',
              (now(), ctx.actor, pid, field, purpose))


def require(body, *keys):
    for k in keys:
        if body.get(k) in (None, ''):
            raise ApiError(400, f'필수 항목이 비어 있습니다: {k}')


# ---------- 로그인 ----------

@route('GET', '/auth/options', public=True)
def auth_options(ctx, body):
    out = ctx.auth.options()
    if out['dev_login']:
        out['users'] = [person_out(p) for p in ctx.db.q('SELECT * FROM people WHERE active=1 ORDER BY is_admin DESC, id')]
    return out


@route('POST', '/auth/(dev|sso)', public=True)
def auth_login(ctx, body, method):
    token = ctx.auth.login(ctx.db, method, body)
    ctx.cookies.append(f'sid={token}; Path=/; HttpOnly; SameSite=Lax')
    return {'ok': True}


@route('POST', '/auth/logout', public=True)
def auth_logout(ctx, body):
    ctx.auth.logout(ctx.db, ctx.token)
    ctx.cookies.append('sid=; Path=/; Max-Age=0')
    return {'ok': True}


@route('GET', '/me')
def me(ctx, body):
    return {'user': person_out(ctx.user, admin=bool(ctx.user['is_admin'])),
            'meta': {'today': today(), 'duty_labels': E.DUTY_LABEL, 'depts': E.bisang_depts(ctx.db),
                     'all_depts': sorted({p['dept'] for p in ctx.db.q('SELECT dept FROM people') if p['dept']}),
                     'channels': ctx.nt.status(), 'daily_time': ctx.config.get('daily_notify_time', '17:00'),
                     'no_consecutive': ctx.db.get_setting('no_consecutive', True),
                     'dev_login': ctx.auth.options()['dev_login']}}


# ---------- S1 오늘 · 내 근무 ----------

def _visible(ctx, month):
    st = E.month_status(ctx.db, month)
    return st == 'confirmed' or (st and ctx.user['is_admin'])


@route('GET', '/home')
def home(ctx, body):
    db, uid, t = ctx.db, ctx.user['id'], today()
    today_slots = []
    if _visible(ctx, t[:7]):
        for r in db.q('SELECT * FROM schedule WHERE date=?', (t,)):
            today_slots.append({**r, 'name': E.pname(db, r['person_id']), 'mine': r['person_id'] == uid})
    mine = db.q("SELECT s.* FROM schedule s JOIN months m ON m.month=substr(s.date,1,7) "
                "WHERE s.person_id=? AND m.status='confirmed' AND s.date>=? ORDER BY s.date", (uid, t[:7] + '-01'))
    out = {
        'today': t, 'today_slots': today_slots,
        'next': next((r for r in mine if r['date'] >= t), None),
        'month_list': [r for r in mine if r['date'][:7] == t[:7]],
        'upcoming': [r for r in mine if r['date'] >= t][:10],
        'incoming': [E.swap_row(db, s) for s in db.q("SELECT * FROM swaps WHERE target=? AND status='pending' ORDER BY id", (uid,))],
        'outgoing': [E.swap_row(db, s) for s in db.q('SELECT * FROM swaps WHERE requester=? ORDER BY id DESC LIMIT 10', (uid,))],
        'unavail': db.q('SELECT * FROM unavail WHERE person_id=? AND end>=? ORDER BY start', (uid, t)),
    }
    if ctx.user['is_admin']:
        out['admin'] = {
            'failed': db.q1("SELECT COUNT(*) c FROM notifications WHERE result='fail'")['c'],
            'drafts': [r['month'] for r in db.q("SELECT month FROM months WHERE status='draft'")],
            'makeup': db.q1('SELECT COUNT(*) c FROM makeup')['c'],
            'pending_swaps': db.q1("SELECT COUNT(*) c FROM swaps WHERE status='pending'")['c'],
        }
    return out


# ---------- S2 월간 근무표 ----------

@route('GET', '/schedule')
def schedule(ctx, body):
    db, month = ctx.db, ctx.arg('month') or today()[:7]
    dates = E.month_dates(month)
    status = E.month_status(db, month)
    show = _visible(ctx, month)
    rows = db.q('SELECT * FROM schedule WHERE date LIKE ?', (month + '-%',)) if show else []
    by_date = {}
    for r in rows:
        by_date.setdefault(r['date'], []).append(
            {**r, 'name': E.pname(db, r['person_id']) if r['person_id'] else '', 'mine': r['person_id'] == ctx.user['id']})
    order = {'dangjik': 0, 'iljik': 1, 'bisang': 2}
    days = [{'date': d, 'daytype': E.day_type(db, d), 'holiday': E.holiday(db, d),
             'slots': sorted(by_date.get(d, []), key=lambda s: (order[s['duty']], s['dept']))} for d in dates]
    swaps = db.q("SELECT date, duty, dept FROM swaps WHERE status='pending' AND date LIKE ?", (month + '-%',))
    return {'month': month, 'status': status, 'visible': bool(show), 'days': days, 'pending_swaps': swaps}


@route('GET', '/cell-candidates', admin=True)
def cell_candidates(ctx, body):
    return E.cell_candidates(ctx.db, ctx.arg('date'), ctx.arg('duty'), ctx.arg('dept', ''))


@route('POST', '/schedule/cell', admin=True)
def set_cell(ctx, body):
    require(body, 'date', 'duty')
    return E.set_cell(ctx.db, ctx.nt, ctx.actor, body['date'], body['duty'], body.get('dept', ''),
                      body.get('person_id'), body.get('reason', ''), bool(body.get('force')))


# ---------- S3 편성 관리 ----------

@route('GET', '/months', admin=True)
def months(ctx, body):
    return ctx.db.q('SELECT month, status, updated FROM months ORDER BY month')


@route('POST', r'/months/(\d{4}-\d{2})/(generate|confirm|delete)', admin=True)
def month_action(ctx, body, month, action):
    if action == 'generate':
        return E.generate_month(ctx.db, month, ctx.actor)
    if action == 'confirm':
        E.confirm_month(ctx.db, ctx.nt, month, ctx.actor)
    else:
        E.delete_month(ctx.db, month, ctx.actor)
    return {'ok': True}


@route('GET', '/validate', admin=True)
def validate(ctx, body):
    return E.validate_month(ctx.db, ctx.arg('month'))


@route('GET', '/people')
def people(ctx, body):
    admin = bool(ctx.user['is_admin'])
    sql = 'SELECT * FROM people ORDER BY id' if admin else 'SELECT * FROM people WHERE active=1 ORDER BY id'
    return [person_out(p, admin) for p in ctx.db.q(sql)]


def _person_fields(ctx, body, pid=None):
    require(body, 'name', 'login_id')
    duties = [d for d in body.get('duties', []) if d in E.DUTY_LABEL]
    if 'bisang' in duties and not body.get('dept'):
        raise ApiError(400, '비상대기 대상자는 소속 부서가 필요합니다.')
    dup = ctx.db.q1('SELECT id FROM people WHERE login_id=? AND id IS NOT ?', (body['login_id'], pid))
    if dup:
        raise ApiError(400, '이미 사용 중인 인트라넷 계정 ID입니다.')
    return (body['name'].strip(), body.get('rank', '').strip(), body.get('dept', '').strip(),
            body['login_id'].strip(), body.get('email', '').strip(), body.get('phone', '').strip(),
            ','.join(duties), 1 if body.get('active', True) else 0, 1 if body.get('is_admin') else 0)


@route('POST', '/people', admin=True)
def person_create(ctx, body):
    f = _person_fields(ctx, body)
    pid = ctx.db.ex('INSERT INTO people(name, rank, dept, login_id, email, phone, duties, active, is_admin) '
                    'VALUES(?,?,?,?,?,?,?,?,?)', f)
    E.log_change(ctx.db, ctx.actor, f'인원 {f[1]} {f[0]}', '', '등록')
    return {'id': pid}


@route('GET', r'/people/(\d+)', admin=True)
def person_detail(ctx, body, pid):
    p = ctx.db.q1('SELECT * FROM people WHERE id=?', (pid,))
    if not p:
        raise ApiError(404, '인원을 찾을 수 없습니다.')
    log_access(ctx, p['id'], '군 메일, 휴대폰 번호', '인원 정보 수정 화면')
    return {**person_out(p, True), 'phone': p['phone']}


@route('PUT', r'/people/(\d+)', admin=True)
def person_update(ctx, body, pid):
    old = ctx.db.q1('SELECT * FROM people WHERE id=?', (pid,))
    if not old:
        raise ApiError(404, '인원을 찾을 수 없습니다.')
    f = _person_fields(ctx, body, int(pid))
    ctx.db.ex('UPDATE people SET name=?, rank=?, dept=?, login_id=?, email=?, phone=?, duties=?, active=?, is_admin=? '
              'WHERE id=?', f + (pid,))
    fields = [('name', '이름'), ('rank', '계급'), ('dept', '부서'), ('login_id', '계정'), ('email', '메일'),
              ('phone', '전화'), ('duties', '근무 종류'), ('active', '재직'), ('is_admin', '권한')]
    changed = [label for (col, label), v in zip(fields, f) if str(v) != str('' if old[col] is None else old[col])]
    E.log_change(ctx.db, ctx.actor, f'인원 {f[1]} {f[0]}', '', '정보 수정', ', '.join(changed) + ' 변경' if changed else '')
    return {'ok': True}


@route('POST', r'/people/(\d+)/reveal', admin=True)
def person_reveal(ctx, body, pid):
    p = ctx.db.q1('SELECT * FROM people WHERE id=?', (pid,))
    if not p:
        raise ApiError(404, '인원을 찾을 수 없습니다.')
    log_access(ctx, p['id'], '휴대폰 번호', body.get('purpose') or '전화번호 확인')
    return {'phone': p['phone'] or '(미등록)', 'email': p['email'] or '(미등록)'}


@route('GET', '/unavail', admin=True)
def unavail_list(ctx, body):
    rows = ctx.db.q('SELECT * FROM unavail ORDER BY start DESC')
    return [{**r, 'name': E.pname(ctx.db, r['person_id'])} for r in rows]


@route('POST', '/unavail', admin=True)
def unavail_create(ctx, body):
    require(body, 'person_id', 'kind', 'start', 'end')
    if body['kind'] not in E.UNAVAIL_KINDS:
        raise ApiError(400, '구분은 휴가 또는 출장입니다.')
    E.parse_date(body['start']), E.parse_date(body['end'])
    if body['start'] > body['end']:
        raise ApiError(400, '종료일이 시작일보다 빠릅니다.')
    pid = int(body['person_id'])
    if not E.person(ctx.db, pid):
        raise ApiError(400, '인원을 찾을 수 없습니다.')
    uid = ctx.db.ex('INSERT INTO unavail(person_id, kind, start, end, memo, created) VALUES(?,?,?,?,?,?)',
                    (pid, body['kind'], body['start'], body['end'], body.get('memo', ''), now()))
    E.log_change(ctx.db, ctx.actor, f"{body['kind']} {E.pname(ctx.db, pid)}", '',
                 f"{body['start']} ~ {body['end']}", body.get('memo', ''))
    return {'id': uid, 'changes': E.reschedule_unavail(ctx.db, ctx.nt, uid, ctx.actor)}


@route('DELETE', r'/unavail/(\d+)', admin=True)
def unavail_delete(ctx, body, uid):
    u = ctx.db.q1('SELECT * FROM unavail WHERE id=?', (uid,))
    if u:
        ctx.db.ex('DELETE FROM unavail WHERE id=?', (uid,))
        E.log_change(ctx.db, ctx.actor, f"{u['kind']} {E.pname(ctx.db, u['person_id'])}",
                     f"{u['start']} ~ {u['end']}", '삭제', '이미 바뀐 근무표는 그대로 유지')
    return {'ok': True}


@route('GET', '/holidays')
def holidays(ctx, body):
    return ctx.db.q('SELECT * FROM holidays ORDER BY date')


@route('POST', '/holidays', admin=True)
def holiday_create(ctx, body):
    require(body, 'date', 'name')
    E.parse_date(body['date'])
    ctx.db.ex('INSERT INTO holidays(date, name) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET name=excluded.name',
              (body['date'], body['name']))
    E.log_change(ctx.db, ctx.actor, f"공휴일 {body['date']}", '', body['name'])
    return {'ok': True, 'already_planned': bool(E.month_status(ctx.db, body['date'][:7]))}


@route('DELETE', r'/holidays/(\d{4}-\d{2}-\d{2})', admin=True)
def holiday_delete(ctx, body, date):
    ctx.db.ex('DELETE FROM holidays WHERE date=?', (date,))
    E.log_change(ctx.db, ctx.actor, f'공휴일 {date}', '지정', '해제')
    return {'ok': True}


@route('GET', '/draws', admin=True)
def draws(ctx, body):
    rows = ctx.db.q('SELECT * FROM draws ORDER BY id DESC')
    return [{**r, 'names': [E.pname(ctx.db, p) for p in json.loads(r['person_ids'])]} for r in rows]


@route('POST', '/draws', admin=True)
def draw_create(ctx, body):
    try:
        count = int(body.get('count'))
    except (TypeError, ValueError):
        raise ApiError(400, '인원 수를 숫자로 입력하세요.')
    return E.draw(ctx.db, ctx.nt, count, body.get('memo', ''), ctx.actor)


@route('GET', '/makeup', admin=True)
def makeup(ctx, body):
    rows = ctx.db.q('SELECT * FROM makeup ORDER BY id')
    return [{**r, 'name': E.pname(ctx.db, r['person_id']), 'label': E.slot_label(r['duty'], r['dept']),
             'daytype_label': E.DAYTYPE_LABEL[r['daytype']]} for r in rows]


@route('DELETE', r'/makeup/(\d+)', admin=True)
def makeup_delete(ctx, body, mid):
    r = ctx.db.q1('SELECT * FROM makeup WHERE id=?', (mid,))
    if r:
        ctx.db.ex('DELETE FROM makeup WHERE id=?', (mid,))
        E.log_change(ctx.db, ctx.actor, f"보충 대기열 {E.pname(ctx.db, r['person_id'])}",
                     E.slot_label(r['duty'], r['dept']), '삭제')
    return {'ok': True}


@route('GET', '/rotations', admin=True)
def rotations(ctx, body):
    return E.rotation_overview(ctx.db)


@route('GET', '/changelog', admin=True)
def changelog(ctx, body):
    return ctx.db.q('SELECT * FROM changelog ORDER BY id DESC LIMIT 300')


@route('GET', '/access-log', admin=True)
def access_log(ctx, body):
    rows = ctx.db.q('SELECT * FROM access_log ORDER BY id DESC LIMIT 200')
    return [{**r, 'name': E.pname(ctx.db, r['person_id'])} for r in rows]


@route('PUT', '/settings', admin=True)
def settings(ctx, body):
    if 'no_consecutive' in body:
        v = bool(body['no_consecutive'])
        ctx.db.set_setting('no_consecutive', v)
        E.log_change(ctx.db, ctx.actor, '설정: 연속 근무 금지(R5)', '', '켬' if v else '끔')
    return {'ok': True}


# ---------- 교대 ----------

@route('GET', '/swap-candidates')
def swap_candidates(ctx, body):
    return E.swap_candidates(ctx.db, ctx.user, ctx.arg('date'), ctx.arg('duty'), ctx.arg('dept', ''))


@route('POST', '/swaps')
def swap_create(ctx, body):
    require(body, 'date', 'duty', 'target')
    sid = E.create_swap(ctx.db, ctx.nt, ctx.user, body['date'], body['duty'], body.get('dept', ''),
                        body['target'], body.get('target_date'), body.get('memo', ''))
    return {'id': sid}


@route('POST', r'/swaps/(\d+)/(accept|reject|cancel)')
def swap_action(ctx, body, sid, action):
    if action == 'accept':
        E.accept_swap(ctx.db, ctx.nt, ctx.user, int(sid))
    else:
        E.close_swap(ctx.db, ctx.user, int(sid), action)
    return {'ok': True}


@route('GET', '/swaps', admin=True)
def swaps(ctx, body):
    return [E.swap_row(ctx.db, s) for s in ctx.db.q('SELECT * FROM swaps ORDER BY id DESC LIMIT 100')]


# ---------- S4 알림 관리 ----------

@route('GET', '/notifications', admin=True)
def notifications(ctx, body):
    result = ctx.arg('result')
    sql, args = 'SELECT * FROM notifications', ()
    if result in ('success', 'fail'):
        sql, args = sql + ' WHERE result=?', (result,)
    rows = ctx.db.q(sql + ' ORDER BY id DESC LIMIT 300', args)
    summary = {r['result']: r['c'] for r in ctx.db.q('SELECT result, COUNT(*) c FROM notifications GROUP BY result')}
    return {'summary': summary, 'items': [{**r, 'name': E.pname(ctx.db, r['person_id']),
                                           'channel_label': CHANNELS[r['channel']]} for r in rows]}


@route('POST', r'/notifications/(\d+)/resend', admin=True)
def resend(ctx, body, nid):
    ctx.nt.deliver(ctx.db, int(nid))
    return ctx.db.q1('SELECT result, error FROM notifications WHERE id=?', (nid,))


@route('POST', '/notifications/resend-failed', admin=True)
def resend_failed(ctx, body):
    ids = [r['id'] for r in ctx.db.q("SELECT id FROM notifications WHERE result='fail'")]
    for nid in ids:
        ctx.nt.deliver(ctx.db, nid)
    still = ctx.db.q1("SELECT COUNT(*) c FROM notifications WHERE result='fail'")['c']
    return {'tried': len(ids), 'still_failed': still}


@route('GET', '/notifications/upcoming', admin=True)
def upcoming(ctx, body):
    return {**E.upcoming(ctx.db, ctx.nt, ctx.config), 'last_run': ctx.db.get_setting('last_daily_run')}


@route('POST', '/notifications/run-daily', admin=True)
def run_daily(ctx, body):
    target = body.get('date') or E.add_days(today(), 1)
    n = E.run_daily(ctx.db, ctx.nt, target, ctx.config.get('daily_notify_time', '17:00'))
    return {'sent': n, 'date': target}


@route('GET', '/templates', admin=True)
def templates(ctx, body):
    return [{'key': k, 'label': TEMPLATE_LABELS[k], 'text': ctx.nt.template(ctx.db, k),
             'default': DEFAULT_TEMPLATES[k]} for k in DEFAULT_TEMPLATES]


@route('PUT', '/templates', admin=True)
def template_save(ctx, body):
    key = body.get('key')
    if key not in DEFAULT_TEMPLATES:
        raise ApiError(400, '알 수 없는 문구입니다.')
    ctx.db.set_setting('tpl_' + key, body.get('text') or DEFAULT_TEMPLATES[key])
    E.log_change(ctx.db, ctx.actor, f'알림 문구: {TEMPLATE_LABELS[key]}', '', '수정')
    return {'ok': True}
