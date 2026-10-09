// Database tasks against DATABASE_URL_UNPOOLED.
//   migrate : apply db/migrations/*.sql in order, once each (tracked in schema_migrations)
//   seed    : run db/seed.sql (only when the config table is empty)
//   test    : run db/tests/*.sql (each test file rolls itself back)
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error('DATABASE_URL_UNPOOLED is not set (.env.local).');
  process.exit(1);
}

// Neon requires TLS; pin verify-full explicitly (pg treats "require" as verify-full today anyway).
const client = new pg.Client({ connectionString: url.replace('sslmode=require', 'sslmode=verify-full') });
client.on('notice', (n) => console.log(`  ${n.message}`));

async function migrate() {
  await client.query(`create table if not exists public.schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await client.query('select name from public.schema_migrations')).rows.map((r) => r.name));
  for (const file of readdirSync('db/migrations').filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    console.log(`applying ${file}`);
    await client.query('begin');
    try {
      await client.query(readFileSync(`db/migrations/${file}`, 'utf8'));
      await client.query('insert into public.schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    }
  }
  console.log('migrations up to date');
}

async function seed() {
  const { rows } = await client.query('select count(*)::int as n from public.config');
  if (rows[0].n > 0) {
    console.log('config already seeded; skipping');
    return;
  }
  await client.query(readFileSync('db/seed.sql', 'utf8'));
  console.log('seeded');
}

async function test() {
  for (const file of readdirSync('db/tests').filter((f) => f.endsWith('.sql')).sort()) {
    console.log(`running ${file}`);
    await client.query(readFileSync(`db/tests/${file}`, 'utf8'));
  }
  console.log('all database tests passed');
}

const tasks = { migrate, seed, test };
const task = tasks[process.argv[2]];
if (!task) {
  console.error(`usage: node scripts/db.mjs <${Object.keys(tasks).join('|')}>`);
  process.exit(1);
}

await client.connect();
try {
  await task();
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
