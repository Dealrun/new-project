// 데이터베이스 연결: DATABASE_URL(Supabase)이 있으면 Postgres, 없으면 PC 안의 내장 Postgres(PGlite).
// 모든 요청은 하나의 트랜잭션 안에서 처리된다.
import path from 'node:path';
import postgres from 'postgres';

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Tx {
  q(sql: string, params?: unknown[]): Promise<Row[]>;
  q1(sql: string, params?: unknown[]): Promise<Row | null>;
  ex(sql: string, params?: unknown[]): Promise<void>;
  exec(sql: string): Promise<void>; // 여러 문장(파라미터 없음)
}

interface Driver {
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

function wrap(query: (sql: string, params?: unknown[]) => Promise<Row[]>, exec: (sql: string) => Promise<void>): Tx {
  return {
    q: (sql, params = []) => query(sql, params),
    q1: async (sql, params = []) => (await query(sql, params))[0] ?? null,
    ex: async (sql, params = []) => { await query(sql, params); },
    exec,
  };
}

function postgresDriver(url: string): Driver {
  // Supabase Transaction pooler(6543)는 prepared statement를 지원하지 않으므로 prepare: false
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20 });
  return {
    run: (fn) => sql.begin(async (tx) => {
      const t = wrap(
        async (s, p) => (await tx.unsafe(s, p as never[])) as unknown as Row[],
        async (s) => { await tx.unsafe(s); },
      );
      await t.ex('SELECT pg_advisory_xact_lock(4242)'); // 쓰기 요청을 한 줄로 세워 순번 꼬임 방지
      return fn(t);
    }) as Promise<never>,
  };
}

async function pgliteDriver(): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(path.join(process.cwd(), '.pglite'));
  await pg.waitReady;
  let chain: Promise<unknown> = Promise.resolve();
  return {
    run: (fn) => {
      const next = chain.then(() => pg.transaction(async (tx) => fn(wrap(
        async (s, p) => (await tx.query<Row>(s, p)).rows,
        async (s) => { await tx.exec(s); },
      ))));
      chain = next.catch(() => undefined);
      return next;
    },
  };
}

// 개발 모드에서 모듈이 다시 읽혀도 연결을 하나만 쓰도록 전역에 보관
const g = globalThis as unknown as { __dutyDriver?: Promise<Driver> };

function driver() {
  if (!g.__dutyDriver) {
    const url = process.env.DATABASE_URL;
    g.__dutyDriver = url ? Promise.resolve(postgresDriver(url)) : pgliteDriver();
  }
  return g.__dutyDriver;
}

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await driver()).run(fn);
}

export function dbKind() {
  return process.env.DATABASE_URL ? 'supabase' : 'local';
}

export async function getSetting<T>(db: Tx, key: string, def: T): Promise<T> {
  const r = await db.q1('SELECT value FROM settings WHERE key=$1', [key]);
  return r ? (JSON.parse(r.value) as T) : def;
}

export async function setSetting(db: Tx, key: string, value: unknown) {
  await db.ex('INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',
    [key, JSON.stringify(value)]);
}

// 여러 행을 한 번에 넣는다(왕복 횟수 절약)
export async function insertMany(db: Tx, table: string, cols: string[], rows: unknown[][], suffix = '') {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const params: unknown[] = [];
    const values = chunk.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(',')})`);
    await db.ex(`INSERT INTO ${table}(${cols.join(',')}) VALUES ${values.join(',')} ${suffix}`, params);
  }
}
