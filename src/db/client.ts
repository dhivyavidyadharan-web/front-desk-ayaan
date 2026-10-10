// Postgres access (Neon). Webhooks and jobs use withTransaction (table owner, bypasses RLS).
// Dashboard reads use withDashboardUser, which switches to the RLS-enforced app_dashboard role.
import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

let pool: pg.Pool | undefined;

export function createPool(connectionString: string): pg.Pool {
  // Neon requires TLS; pin verify-full explicitly (pg treats "require" as verify-full today anyway).
  return new pg.Pool({ connectionString: connectionString.replace('sslmode=require', 'sslmode=verify-full'), max: 10 });
}

export function getPool(): pg.Pool {
  if (!pool) {
    // `npm run dev:test` points the local app at the Neon test branch.
    const key = process.env.USE_TEST_DB ? 'DATABASE_URL_TEST' : 'DATABASE_URL';
    const url = process.env[key];
    if (!url) throw new Error(`${key} is not set`);
    pool = createPool(url);
  }
  return pool;
}

export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('begin');
    const result = await fn(tx);
    await tx.query('commit');
    return result;
  } catch (err) {
    await tx.query('rollback');
    throw err;
  } finally {
    tx.release();
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withDashboardUser<T>(db: Db, staffId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!GUID.test(staffId)) throw new Error('invalid staff id');
  const tx = await db.connect();
  try {
    // One round trip: open the transaction, switch to the RLS role, say who is asking.
    // staffId is a validated UUID, so inlining it is safe (multi-statement queries take no params).
    await tx.query(`begin; set local role app_dashboard; select set_config('app.user_id', '${staffId}', true);`);
    const result = await fn(tx);
    await tx.query('commit');
    return result;
  } catch (err) {
    await tx.query('rollback').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}

/** Runs each callback in its own RLS transaction, so independent reads can go in parallel. */
export type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
export const dashboardRunner = (staffId: string): Run => (fn) => withDashboardUser(getPool(), staffId, fn);
