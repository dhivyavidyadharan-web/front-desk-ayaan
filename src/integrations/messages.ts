// Telegram messages to designers: the same snapshot as the dashboard's project brief, kept short.
// Brief §4.1: handoffs never carry a price, so budget figures are never included, and any free
// text that trips the price scan is withheld.
import { scanTextForPriceLeaks } from '../core/priceLeak';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const IST = 'Asia/Kolkata';
export const fmtSlot = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d);

/** Free text from the extraction (note, expectations) is checked before it is sent. */
export function safeText(text: string | null | undefined): string | null {
  if (!text) return null;
  return scanTextForPriceLeaks(text).length ? '(withheld: mentioned a price; see the dashboard)' : text;
}

export interface LeadSnapshot {
  name: string | null;
  phone: string;
  area: string | null;
  scope: string | null;
  sizeSqft: number | null;
  timeline: string | null;
  decides: string | null;
  wants: string | null;
  note: string | null;
  flags: string[];
  transcriptUrl: string | null;
  leadUrl: string;
}

const line = (label: string, value: string | null | undefined) => (value ? `<b>${label}:</b> ${esc(value)}\n` : '');

function snapshot(s: LeadSnapshot) {
  return (
    line('Client', `${s.name ?? 'Unknown'} · ${s.phone}`) +
    line('Area', s.area) +
    line('Scope', s.scope) +
    line('Size', s.sizeSqft ? `${s.sizeSqft.toLocaleString('en-IN')} sq ft` : null) +
    line('Timeline', s.timeline) +
    line('Who decides', s.decides) +
    line('Wants', safeText(s.wants)) +
    line('Note', safeText(s.note)) +
    (s.flags.length ? `<b>Good to know:</b> ${esc(s.flags.join(', '))}\n` : '')
  );
}

function links(s: LeadSnapshot) {
  return `\n${s.transcriptUrl ? `<a href="${esc(s.transcriptUrl)}">Read the full transcript</a> · ` : ''}<a href="${esc(s.leadUrl)}">Open the lead</a>`;
}

export function qualifiedMessage(s: LeadSnapshot) {
  return `✨ <b>New qualified lead for you</b>\n${snapshot(s)}${links(s)}`;
}

export function bookingMessage(s: LeadSnapshot, b: { start: Date; locationType: 'online' | 'studio' | null }) {
  const where = b.locationType === 'online' ? 'Online (video link in your cal.com email)' : b.locationType === 'studio' ? 'At the studio' : 'See booking';
  return `📅 <b>Consultation booked with you</b>\n${line('When', fmtSlot(b.start))}${line('Where', where)}${snapshot(s)}${links(s)}`;
}

export function cancelledMessage(s: Pick<LeadSnapshot, 'name' | 'phone' | 'leadUrl'>, start: Date) {
  return `❌ <b>Consultation cancelled</b>\n${line('Client', `${s.name ?? 'Unknown'} · ${s.phone}`)}${line('Was', fmtSlot(start))}\n<a href="${esc(s.leadUrl)}">Open the lead</a>`;
}
