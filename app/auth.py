"""로그인 연동 모듈. 설정(config.json의 auth)만 바꿔 임시 로그인 ↔ 인트라넷 SSO를 교체한다."""
import secrets

from .common import ApiError, now


class DevLogin:
    """개발·시연용 임시 로그인: 관리자가 등록한 계정을 선택해 들어간다. 운영 전환 시 비활성화."""

    def __init__(self, cfg):
        self.enabled = bool(cfg.get('dev_login', True))

    def resolve(self, db, body):
        if not self.enabled:
            raise ApiError(403, '임시 로그인이 비활성화되어 있습니다.')
        p = db.q1('SELECT * FROM people WHERE id=? AND active=1', (body.get('person_id'),))
        if not p:
            raise ApiError(400, '계정을 찾을 수 없습니다.')
        return p


class IntranetSSO:
    """군 인트라넷 계정 연동(X1). 규격 수신 후 resolve()에서 토큰을 검증하고 login_id로 인원을 찾는다."""

    def __init__(self, cfg):
        self.cfg = cfg.get('sso', {})
        self.enabled = bool(self.cfg.get('enabled'))

    def resolve(self, db, body):
        raise ApiError(501, '인트라넷 SSO 연동 규격(X1)을 받은 뒤 구현됩니다. 지금은 임시 로그인을 사용하세요.')


class Auth:
    def __init__(self, config):
        cfg = config.get('auth', {})
        self.dev = DevLogin(cfg)
        self.sso = IntranetSSO(cfg)

    def options(self):
        return {'dev_login': self.dev.enabled, 'sso': self.sso.enabled}

    def login(self, db, method, body):
        p = (self.dev if method == 'dev' else self.sso).resolve(db, body)
        token = secrets.token_urlsafe(32)
        db.ex('INSERT INTO sessions(token, person_id, created) VALUES(?,?,?)', (token, p['id'], now()))
        return token

    def user(self, db, token):
        if not token:
            return None
        return db.q1('SELECT p.* FROM sessions s JOIN people p ON p.id=s.person_id '
                     'WHERE s.token=? AND p.active=1', (token,))

    def logout(self, db, token):
        db.ex('DELETE FROM sessions WHERE token=?', (token,))
