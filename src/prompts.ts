// Versioned prompts live in /prompts (reviewed in git). The version is a hash of the file, so
// every stored call records exactly which prompt produced it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cache = new Map<string, { text: string; version: string }>();

export function loadPrompt(name: 'voice_agent' | 'extraction'): { text: string; version: string } {
  const hit = cache.get(name);
  if (hit) return hit;
  const text = readFileSync(join(process.cwd(), 'prompts', `${name}.md`), 'utf8');
  const version = `${name}@${createHash('sha256').update(text).digest('hex').slice(0, 10)}`;
  const loaded = { text, version };
  cache.set(name, loaded);
  return loaded;
}

export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}
