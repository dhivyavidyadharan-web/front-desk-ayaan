// Brief §4.1: post-call scan of every agent turn (and any outgoing text) for anything that
// states or hints at a price. Any hit sets price_leak_flag and raises an alert.
import type { Turn } from '../channels/interaction';

export interface PriceLeakHit {
  pattern: string;
  match: string;
  turnIndex?: number;
}

const CURRENCY = String.raw`(?:₹|rs\.?|inr|rupees?)`;
const COST_WORD = String.raw`(?:cost|costs|price|prices|pricing|rate|rates|budget|charge|charges|fee|fees|rs\.?|₹|lakh|lakhs|crore)`;

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'currency_amount', re: new RegExp(String.raw`${CURRENCY}\s?\d`, 'i') },
  { name: 'amount_currency', re: new RegExp(String.raw`\d[\d,.]*\s?(?:${CURRENCY})\b`, 'i') },
  { name: 'lakh_crore', re: /\b(?:lakhs?|lacs?|crores?)\b|\d\s?(?:l|cr)\b|लाख|करोड/i },
  { name: 'thousand_amount', re: /\b\d+\s?(?:k|thousand|hazaa?r)\b|\d\s?हजार/i },
  { name: 'per_sq_ft', re: /(?:per|\/)\s?(?:sq\.?\s?(?:ft|feet|foot)|square\s(?:foot|feet))|\bpsf\b/i },
  {
    name: 'starts_at',
    re: new RegExp(
      String.raw`\bstart(?:s|ing)?\s(?:at|from)\s${CURRENCY}|\b(?:${COST_WORD}|packages?)\b[^.?!]{0,30}\bstart(?:s|ing)?\b`,
      'i',
    ),
  },
  { name: 'approximately', re: new RegExp(String.raw`\b(?:approx(?:imately)?|around|about|roughly)\s${CURRENCY}`, 'i') },
  { name: 'cost_around', re: /\b(?:cost|come to|be)\s(?:around|about|roughly|approximately)\b/i },
  { name: 'typically_cost', re: new RegExp(String.raw`\btypically\b[^.?!]{0,40}${COST_WORD}|${COST_WORD}[^.?!]{0,40}\btypically\b`, 'i') },
  { name: 'relative_cost', re: /\d+(?:\.\d+)?\s?(?:x|×|times)\s(?:the\s)?(?:cost|price)/i },
];

export function scanTextForPriceLeaks(text: string): PriceLeakHit[] {
  const hits: PriceLeakHit[] = [];
  for (const { name, re } of PATTERNS) {
    const m = text.match(re);
    if (m) hits.push({ pattern: name, match: m[0] });
  }
  return hits;
}

/** Scans agent turns only: callers may say numbers; the agent may not. */
export function scanTranscriptForPriceLeaks(turns: Turn[]): PriceLeakHit[] {
  return turns.flatMap((turn, turnIndex) =>
    turn.speaker === 'agent' ? scanTextForPriceLeaks(turn.text).map((h) => ({ ...h, turnIndex })) : [],
  );
}
