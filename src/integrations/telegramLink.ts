// Signed codes for the "Connect Telegram" links. A designer taps https://t.me/<bot>?start=<code>;
// the team group sends "/team <code>". The HMAC stops anyone linking themselves by guessing ids.
// Telegram start payloads allow up to 64 chars of [A-Za-z0-9_-].
import { createHmac, timingSafeEqual } from 'node:crypto';

const sign = (secret: string, subject: string) => createHmac('sha256', secret).update(`tg-link:${subject}`).digest('base64url').slice(0, 12);

export function designerLinkCode(designerId: string, secret: string): string {
  const hex = designerId.replace(/-/g, '').toLowerCase();
  return `d${hex}_${sign(secret, `designer:${hex}`)}`;
}

export function teamLinkCode(secret: string): string {
  return `team_${sign(secret, 'team')}`;
}

export type LinkTarget = { kind: 'designer'; designerId: string } | { kind: 'team' };

export function parseLinkCode(code: string, secret: string): LinkTarget | null {
  const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const team = code.match(/^team_([A-Za-z0-9_-]{12})$/);
  if (team) return safeEq(team[1]!, sign(secret, 'team')) ? { kind: 'team' } : null;
  const d = code.match(/^d([0-9a-f]{32})_([A-Za-z0-9_-]{12})$/);
  if (!d || !safeEq(d[2]!, sign(secret, `designer:${d[1]}`))) return null;
  const h = d[1]!;
  return { kind: 'designer', designerId: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` };
}
