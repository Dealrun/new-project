import json
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS people(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, rank TEXT, dept TEXT,
  login_id TEXT UNIQUE, email TEXT, phone TEXT, duties TEXT DEFAULT '',
  active INTEGER DEFAULT 1, is_admin INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS rotations(
  key TEXT PRIMARY KEY, duty TEXT, dept TEXT, daytype TEXT, order_json TEXT, pos INTEGER);
CREATE TABLE IF NOT EXISTS makeup(
  id INTEGER PRIMARY KEY, person_id INTEGER, duty TEXT, dept TEXT, daytype TEXT, reason TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS unavail(
  id INTEGER PRIMARY KEY, person_id INTEGER, kind TEXT, start TEXT, end TEXT, memo TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS holidays(date TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS schedule(
  date TEXT, duty TEXT, dept TEXT DEFAULT '', person_id INTEGER, PRIMARY KEY(date, duty, dept));
CREATE TABLE IF NOT EXISTS months(month TEXT PRIMARY KEY, status TEXT, snapshot TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS draws(
  id INTEGER PRIMARY KEY, created TEXT, count INTEGER, person_ids TEXT, memo TEXT, actor TEXT);
CREATE TABLE IF NOT EXISTS swaps(
  id INTEGER PRIMARY KEY, requester INTEGER, target INTEGER, date TEXT, duty TEXT, dept TEXT,
  target_date TEXT, status TEXT, memo TEXT, created TEXT, processed TEXT);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, person_id INTEGER, channel TEXT, kind TEXT, content TEXT, ref TEXT,
  scheduled_at TEXT, created TEXT, sent_at TEXT, result TEXT, error TEXT, note TEXT, attempts INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS changelog(
  id INTEGER PRIMARY KEY, ts TEXT, actor TEXT, target TEXT, before TEXT, after TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS access_log(
  id INTEGER PRIMARY KEY, ts TEXT, actor TEXT, person_id INTEGER, field TEXT, purpose TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, person_id INTEGER, created TEXT);
"""


class DB:
    def __init__(self, path):
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def q(self, sql, args=()):
        return [dict(r) for r in self.conn.execute(sql, args).fetchall()]

    def q1(self, sql, args=()):
        r = self.conn.execute(sql, args).fetchone()
        return dict(r) if r else None

    def ex(self, sql, args=()):
        return self.conn.execute(sql, args).lastrowid

    def commit(self):
        self.conn.commit()

    def rollback(self):
        self.conn.rollback()

    def get_setting(self, key, default=None):
        r = self.q1('SELECT value FROM settings WHERE key=?', (key,))
        return json.loads(r['value']) if r else default

    def set_setting(self, key, value):
        self.ex('INSERT INTO settings(key, value) VALUES(?, ?) '
                'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                (key, json.dumps(value, ensure_ascii=False)))
