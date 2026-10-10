// Reads a Postgres connection string from stdin and writes it into .env.local under the given
// keys (default DATABASE_URL and DATABASE_URL_UNPOOLED). Never prints the value.
// Usage: npx neonctl connection-string --project-id <id> | node scripts/set-db-url.mjs [KEY ...]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const input = readFileSync(0, 'utf8').trim().split('\n').find((l) => l.startsWith('postgres'));
if (!input) {
  console.error('No connection string received.');
  process.exit(1);
}

const path = '.env.local';
let env = existsSync(path) ? readFileSync(path, 'utf8') : '';
const keys = process.argv.slice(2).length ? process.argv.slice(2) : ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'];
for (const key of keys) {
  const line = `${key}=${input}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  env = re.test(env) ? env.replace(re, () => line) : `${env.trimEnd()}\n${line}\n`;
}
writeFileSync(path, env, { mode: 0o600 });
console.log(`Saved ${keys.join(' and ')} to .env.local`);
