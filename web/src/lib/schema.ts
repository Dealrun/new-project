// 서버가 처음 요청을 받을 때 자동으로 실행된다(이미 있으면 건너뜀).
// 모든 표에 RLS를 켜 두어, Supabase의 공개 키(anon)로는 어떤 표도 읽거나 쓸 수 없다.
// 이 앱은 서버(DATABASE_URL)로만 접근한다.
const TABLES = `
CREATE TABLE IF NOT EXISTS people(
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, rank TEXT DEFAULT '', dept TEXT DEFAULT '',
  login_id TEXT UNIQUE, email TEXT DEFAULT '', phone TEXT DEFAULT '', duties TEXT DEFAULT '',
  active INT DEFAULT 1, is_admin INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS rotations(
  key TEXT PRIMARY KEY, duty TEXT, dept TEXT, daytype TEXT, order_json TEXT, pos INT);
CREATE TABLE IF NOT EXISTS makeup(
  id SERIAL PRIMARY KEY, person_id INT, duty TEXT, dept TEXT, daytype TEXT, reason TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS unavail(
  id SERIAL PRIMARY KEY, person_id INT, kind TEXT, start_date TEXT, end_date TEXT, memo TEXT DEFAULT '', created TEXT);
CREATE TABLE IF NOT EXISTS holidays(date TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS schedule(
  date TEXT, duty TEXT, dept TEXT DEFAULT '', person_id INT, PRIMARY KEY(date, duty, dept));
CREATE TABLE IF NOT EXISTS months(month TEXT PRIMARY KEY, status TEXT, snapshot TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS draws(
  id SERIAL PRIMARY KEY, created TEXT, count INT, person_ids TEXT, memo TEXT, actor TEXT);
CREATE TABLE IF NOT EXISTS swaps(
  id SERIAL PRIMARY KEY, requester INT, target INT, date TEXT, duty TEXT, dept TEXT,
  target_date TEXT, status TEXT, memo TEXT, created TEXT, processed TEXT);
CREATE TABLE IF NOT EXISTS notifications(
  id SERIAL PRIMARY KEY, person_id INT, channel TEXT, kind TEXT, content TEXT, ref TEXT,
  scheduled_at TEXT, created TEXT, sent_at TEXT, result TEXT, error TEXT, note TEXT, attempts INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS changelog(
  id SERIAL PRIMARY KEY, ts TEXT, actor TEXT, target TEXT, before TEXT, after TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS access_log(
  id SERIAL PRIMARY KEY, ts TEXT, actor TEXT, person_id INT, field TEXT, purpose TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, person_id INT, created TEXT);
`;

const NAMES = ['people', 'rotations', 'makeup', 'unavail', 'holidays', 'schedule', 'months', 'draws', 'swaps',
  'notifications', 'changelog', 'access_log', 'settings', 'sessions'];

export const SCHEMA = TABLES + NAMES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).join('\n');
