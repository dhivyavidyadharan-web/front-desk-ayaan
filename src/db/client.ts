// Postgres access (Neon). Webhooks and jobs use withTransaction (table owner, bypasses RLS).
// Dashboard reads use withDashboardUser, which switches to the RLS-enforced app_dashboard role.
import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

let pool: pg.Pool | undefined;

export function createPool(connectionString: string): pg.Pool {
  // Neon requires TLS; pin verify-full explicitly (pg treats "require" as verify-full today anyway).
  return new pg.Pool({ connectionString: connectionString.replace('sslmode=require', 'sslmode=verify-full'), max: 5 });
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

export async function withDashboardUser<T>(db: Db, staffId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    await tx.query('set local role app_dashboard');
    await tx.query(`select set_config('app.user_id', $1, true)`, [staffId]);
    return fn(tx);
  });
}
