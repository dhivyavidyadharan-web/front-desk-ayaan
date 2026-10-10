// Saves a key from the macOS clipboard into .env.local without showing it.
// Usage: copy the key, then run:  node scripts/set-secret.mjs GEMINI_API_KEY
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ALLOWED = ['VAANI_API_KEY', 'GEMINI_API_KEY'];
const key = process.argv[2];
if (!ALLOWED.includes(key)) {
  console.error(`Usage: node scripts/set-secret.mjs <${ALLOWED.join('|')}>`);
  process.exit(1);
}

// Keys never contain whitespace; strip any line breaks picked up when copying.
const value = execFileSync('pbpaste', { encoding: 'utf8' }).replace(/\s+/g, '');
if (value.length < 16) {
  console.error('The clipboard does not look like a key. Copy the key first, then run this again.');
  process.exit(1);
}

const path = '.env.local';
let env = existsSync(path) ? readFileSync(path, 'utf8') : '';
const line = `${key}=${value}`;
const re = new RegExp(`^${key}=.*$`, 'm');
env = re.test(env) ? env.replace(re, () => line) : `${env.trimEnd()}\n${line}\n`;
writeFileSync(path, env, { mode: 0o600 });
console.log(`Saved ${key} to .env.local (${value.length} characters). You can clear your clipboard now.`);
