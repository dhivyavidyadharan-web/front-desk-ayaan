import type { Turn } from '../interaction';

const LINE = /^\s*(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?(AGENT|ASSISTANT|BOT|USER|CUSTOMER|CALLER)\s*:\s*(.*)$/i;

/**
 * Parses a provider transcript like
 *   "[13:33:14] AGENT: Hi!\n\n[13:33:19] USER: Hello"   or   "AGENT: Hi!\n\n USER: Hello"
 * into turns. Lines without a speaker label continue the previous turn.
 */
export function parseTranscriptText(text: string | null | undefined): Turn[] {
  if (!text) return [];
  const turns: Turn[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(LINE);
    if (m) {
      const speaker = /^(USER|CUSTOMER|CALLER)$/i.test(m[2]!) ? 'caller' : 'agent';
      turns.push({ speaker, text: m[3]!.trim(), ...(m[1] ? { at: m[1] } : {}) });
    } else if (turns.length) {
      turns[turns.length - 1]!.text += ` ${line}`;
    }
  }
  return turns.filter((t) => t.text.length > 0);
}
