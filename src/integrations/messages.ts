// Telegram message text. Pure functions. Brief §4.1: designer handoffs never carry a price, so
// budget figures are never included, and any free text that trips the price scan is withheld.
import { scanTextForPriceLeaks } from '../core/priceLeak';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const IST = 'Asia/Kolkata';
export const fmtSlot = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d);

/** Free text from the extraction (handoff note, expectations) is checked before it is sent. */
export function safeText(text: string | null | undefined): string | null {
  if (!text) return null;
  return scanTextForPriceLeaks(text).length ? '(withheld: mentioned a price; see the dashboard)' : text;
}

export interface LeadFacts {
  name: string | null;
  phone: string;
  area: string | null;
  scope: string | null;
  sizeSqft: number | null;
  timeline: string | null;
  expectations: string | null;
  handoffNote: string | null;
  flags: string[];
  leadUrl: string;
}

const line = (label: string, value: string | null | undefined) => (value ? `<b>${label}:</b> ${esc(value)}\n` : '');

function facts(l: LeadFacts) {
  return (
    line('Caller', `${l.name ?? 'Unknown'} · ${l.phone}`) +
    line('Area', l.area) +
    line('Scope', l.scope) +
    line('Size', l.sizeSqft ? `${l.sizeSqft.toLocaleString('en-IN')} sq ft` : null) +
    line('Timeline', l.timeline) +
    line('Wants', safeText(l.expectations)) +
    line('Note', safeText(l.handoffNote)) +
    (l.flags.length ? `<b>Watch for:</b> ${esc(l.flags.join(', '))}\n` : '')
  );
}

export function bookingMessage(l: LeadFacts, b: { start: Date; locationType: 'online' | 'studio' | null; designerName: string | null }) {
  const where = b.locationType === 'online' ? 'Online (video)' : b.locationType === 'studio' ? 'At the studio' : 'See booking';
  return (
    `📅 <b>New consultation</b>\n` +
    line('When', fmtSlot(b.start)) +
    line('Where', where) +
    line('Designer', b.designerName) +
    facts(l) +
    `\n<a href="${esc(l.leadUrl)}">Open lead and full transcript</a>`
  );
}

export function cancelledMessage(l: Pick<LeadFacts, 'name' | 'phone' | 'leadUrl'>, start: Date) {
  return `❌ <b>Consultation cancelled</b>\n${line('Caller', `${l.name ?? 'Unknown'} · ${l.phone}`)}${line('Was', fmtSlot(start))}\n<a href="${esc(l.leadUrl)}">Open lead</a>`;
}

const OUTCOME_ICON: Record<string, string> = { qualified: '✅', declined: '➖', unsure: '❓', escalate_complaint: '⚠️', missed: '📵' };
const OUTCOME_TEXT: Record<string, string> = {
  qualified: 'Qualified lead',
  declined: 'Not a fit',
  unsure: 'Needs a follow-up question',
  escalate_complaint: 'Existing client complaint',
  missed: 'Missed or dropped call (call-back reminder added)',
};

export function callSummaryMessage(
  l: LeadFacts,
  c: { outcome: string | null; declineReason: string | null; openQuestion: string | null; complaint: string | null; afterHours: boolean },
) {
  const outcome = c.outcome ?? 'needs_review';
  return (
    `${OUTCOME_ICON[outcome] ?? '📝'} <b>${esc(OUTCOME_TEXT[outcome] ?? 'Call needs review')}</b>${c.afterHours ? ' · after hours' : ''}\n` +
    facts(l) +
    line('Why declined', c.declineReason) +
    line('Open question', c.openQuestion) +
    line('Complaint', safeText(c.complaint)) +
    `\n<a href="${esc(l.leadUrl)}">Open on the dashboard</a>`
  );
}
