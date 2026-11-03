"""OnDuty 서버. 실행: python server.py  (Python 3.9+ 표준 라이브러리만 사용)"""
import json
import mimetypes
import os
import sys
import threading
import time
import traceback
import webbrowser
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

from app import api, engine, seed  # noqa: E402
from app.auth import Auth  # noqa: E402
from app.common import ApiError  # noqa: E402
from app.db import DB  # noqa: E402
from app.notifier import Notifier  # noqa: E402

with open(os.path.join(BASE, 'config.json'), encoding='utf-8') as f:
    CONFIG = json.load(f)

STATIC = os.path.join(BASE, 'static')
LOCK = threading.RLock()
db = DB(os.path.join(BASE, CONFIG.get('db_path', 'data.db')))
notifier = Notifier(CONFIG)
auth = Auth(CONFIG)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        self.handle_request('GET')

    def do_POST(self):
        self.handle_request('POST')

    def do_PUT(self):
        self.handle_request('PUT')

    def do_DELETE(self):
        self.handle_request('DELETE')

    def handle_request(self, method):
        url = urlparse(self.path)
        if not url.path.startswith('/api/'):
            return self.serve_static(url.path)
        cookie = SimpleCookie(self.headers.get('Cookie', ''))
        token = cookie['sid'].value if 'sid' in cookie else None
        ctx = api.Ctx(db, CONFIG, notifier, auth, parse_qs(url.query), token)
        with LOCK:
            try:
                length = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(length).decode('utf-8')) if length else {}
                status, payload = 200, api.dispatch(method, url.path, ctx, body)
                db.commit()
            except ApiError as e:
                db.rollback()
                status, payload = e.status, {'error': e.message}
            except Exception as e:
                db.rollback()
                traceback.print_exc()
                status, payload = 500, {'error': f'서버 오류: {e}'}
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        for c in ctx.cookies:
            self.send_header('Set-Cookie', c)
        self.end_headers()
        self.wfile.write(data)

    def serve_static(self, path):
        rel = 'index.html' if path in ('/', '') else path.lstrip('/').removeprefix('static/')
        full = os.path.normpath(os.path.join(STATIC, rel))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            full = os.path.join(STATIC, 'index.html')
        with open(full, 'rb') as fh:
            data = fh.read()
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype.endswith('javascript'):
            ctype += '; charset=utf-8'
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)


def scheduler_loop():
    """매일 지정 시각(기본 17:00)에 다음 날 근무자 알림을 만든다."""
    while True:
        try:
            with LOCK:
                engine.maybe_run_daily(db, notifier, CONFIG)
                db.commit()
        except Exception:
            traceback.print_exc()
        time.sleep(30)


def main():
    with LOCK:
        db.ex("UPDATE settings SET value=REPLACE(value, '[근무순번도우미]', '[국방부]') WHERE key LIKE 'tpl_%'")
        if seed.seed_if_empty(db):
            print('처음 실행: 시연용 가상 데이터(인원 41명, 이번 달 근무표)를 만들었습니다.')
        db.commit()
    threading.Thread(target=scheduler_loop, daemon=True).start()
    host, port = CONFIG.get('host', '127.0.0.1'), int(CONFIG.get('port', 8000))
    server = ThreadingHTTPServer((host, port), Handler)
    url = f'http://{"localhost" if host in ("0.0.0.0", "127.0.0.1") else host}:{port}'
    print(f'OnDuty 실행 중: {url}  (종료: Ctrl+C)')
    if CONFIG.get('open_browser', True) and '--no-browser' not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('종료합니다.')


if __name__ == '__main__':
    main()
