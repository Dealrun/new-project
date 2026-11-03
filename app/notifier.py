"""알림 발송: 군 메일(SMTP) + 군 알림톡(어댑터). 연동 정보가 없으면 테스트 모드로 기록만 남긴다."""
import json
import smtplib
import urllib.request
from email.header import Header
from email.mime.text import MIMEText

from .common import now

DEFAULT_TEMPLATES = {
    'reminder': '[국방부] {name}님, 내일 {date} {duty} 근무입니다.',
    'change': '[국방부] {name}님, 근무가 변경되었습니다. {detail}',
    'swap_request': '[국방부] {name}님, 교대 요청이 도착했습니다. {detail}',
    'swap_done': '[국방부] {name}님, 교대가 성립되었습니다. {detail}',
    'draw': '[국방부] {name}님, 차출 인원으로 선발되었습니다. {detail}',
    'confirm': '[국방부] {name}님, {date} 근무표가 확정되었습니다. {detail}',
}
TEMPLATE_LABELS = {
    'reminder': '전날 17:00 알림', 'change': '근무 변경(재편성·수동 수정)', 'swap_request': '교대 요청 도착',
    'swap_done': '교대 성립', 'draw': '차출 선발', 'confirm': '근무표 확정',
}
CHANNELS = {'mail': '군 메일', 'alimtalk': '알림톡'}


class _Safe(dict):
    def __missing__(self, key):
        return '{' + key + '}'


class Notifier:
    def __init__(self, config):
        self.mail_cfg = config.get('mail', {})
        self.talk_cfg = config.get('alimtalk', {})

    def status(self):
        return {'mail': bool(self.mail_cfg.get('enabled')), 'alimtalk': bool(self.talk_cfg.get('enabled'))}

    def template(self, db, key):
        return db.get_setting('tpl_' + key, DEFAULT_TEMPLATES[key])

    def render(self, db, key, **kw):
        return self.template(db, key).format_map(_Safe(kw))

    def send(self, db, pid, kind, content, ref=None, scheduled_at=None):
        for ch in CHANNELS:
            nid = db.ex('INSERT INTO notifications(person_id, channel, kind, content, ref, scheduled_at, created) '
                        'VALUES(?,?,?,?,?,?,?)', (pid, ch, kind, content, ref, scheduled_at or now(), now()))
            self.deliver(db, nid)

    def deliver(self, db, nid):
        n = db.q1('SELECT * FROM notifications WHERE id=?', (nid,))
        p = db.q1('SELECT * FROM people WHERE id=?', (n['person_id'],))
        note = None
        try:
            if not p:
                raise RuntimeError('대상자 없음')
            if n['channel'] == 'mail':
                if not p['email']:
                    raise RuntimeError('군 메일 주소 미등록')
                if self.mail_cfg.get('enabled'):
                    self._smtp(p['email'], n['content'])
                else:
                    note = '테스트 모드: 실제 발송 없이 기록만 남김'
            else:
                if not p['phone']:
                    raise RuntimeError('휴대폰 번호 미등록')
                if self.talk_cfg.get('enabled'):
                    self._alimtalk(p['phone'], n['content'])
                else:
                    note = '테스트 모드: 실제 발송 없이 기록만 남김'
            db.ex("UPDATE notifications SET result='success', error=NULL, note=?, sent_at=?, attempts=attempts+1 "
                  'WHERE id=?', (note, now(), nid))
        except Exception as e:  # 발송 실패는 기록하고 간부 화면에서 재발송
            db.ex("UPDATE notifications SET result='fail', error=?, sent_at=?, attempts=attempts+1 WHERE id=?",
                  (str(e), now(), nid))

    def _smtp(self, to, content):
        c = self.mail_cfg
        msg = MIMEText(content, 'plain', 'utf-8')
        msg['Subject'] = Header(c.get('subject', '[국방부] 근무 알림'), 'utf-8')
        msg['From'] = c['from']
        msg['To'] = to
        with smtplib.SMTP(c['host'], int(c.get('port', 25)), timeout=10) as s:
            if c.get('starttls'):
                s.starttls()
            if c.get('user'):
                s.login(c['user'], c.get('password', ''))
            s.sendmail(c['from'], [to], msg.as_string())

    def _alimtalk(self, phone, content):
        # 알림톡 체계 연동 규격(X3) 수신 전 임시 어댑터: JSON POST. 규격에 맞게 이 함수만 바꾸면 된다.
        c = self.talk_cfg
        body = json.dumps({'sender': c.get('sender', ''), 'to': phone, 'message': content}).encode('utf-8')
        req = urllib.request.Request(c['endpoint'], data=body, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as r:
            if r.status >= 300:
                raise RuntimeError(f'알림톡 응답 {r.status}')
