// cal.com booking webhooks. The agent books through Vaani's cal.com integration; cal.com then
// tells us about the booking here. Signed with HMAC-SHA256 in the X-Cal-Signature-256 header.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { normalizePhone } from '../core/phone';

export function verifyCalSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(header.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const person = z.object({ name: z.string().nullish(), email: z.string().nullish(), phoneNumber: z.string().nullish() }).passthrough();
const webhook = z.object({
  triggerEvent: z.string(),
  payload: z
    .object({
      uid: z.string(),
      title: z.string().nullish(),
      startTime: z.string(),
      endTime: z.string().nullish(),
      location: z.string().nullish(),
      attendees: z.array(person).default([]),
      organizer: person.nullish(),
      metadata: z.object({ videoCallUrl: z.string().nullish() }).passthrough().nullish(),
      responses: z.record(z.string(), z.unknown()).nullish(),
    })
    .passthrough(),
});

export interface CalBooking {
  uid: string;
  startTime: Date;
  endTime: Date | null;
  attendee: { name: string | null; email: string | null; phone: string | null };
  organizerEmail: string | null;
  locationType: 'online' | 'studio' | null;
  location: string | null;
  meetingUrl: string | null;
}

export type CalEvent =
  | { kind: 'booked' | 'rescheduled' | 'cancelled'; booking: CalBooking }
  | { kind: 'ignored'; reason: string };

const VIDEO = /integrations:|daily|cal video|zoom|google|meet|teams|video|https?:\/\//i;

function responseValue(responses: Record<string, unknown> | null | undefined, key: string): string | null {
  const r = responses?.[key];
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object' && 'value' in r && typeof (r as { value: unknown }).value === 'string') return (r as { value: string }).value;
  return null;
}

export function parseCalWebhook(json: unknown): CalEvent {
  const parsed = webhook.safeParse(json);
  if (!parsed.success) return { kind: 'ignored', reason: 'not a booking payload' };
  const { triggerEvent, payload: p } = parsed.data;
  const kind = ({ BOOKING_CREATED: 'booked', BOOKING_RESCHEDULED: 'rescheduled', BOOKING_CANCELLED: 'cancelled' } as const)[
    triggerEvent as 'BOOKING_CREATED'
  ];
  if (!kind) return { kind: 'ignored', reason: triggerEvent };

  const a = p.attendees[0];
  const rawPhone = a?.phoneNumber ?? responseValue(p.responses, 'attendeePhoneNumber') ?? responseValue(p.responses, 'phone');
  const location = p.location ?? null;
  const meetingUrl = p.metadata?.videoCallUrl ?? (location && /^https?:\/\//.test(location) ? location : null);
  return {
    kind,
    booking: {
      uid: p.uid,
      startTime: new Date(p.startTime),
      endTime: p.endTime ? new Date(p.endTime) : null,
      attendee: { name: a?.name ?? null, email: a?.email?.toLowerCase() ?? null, phone: rawPhone ? normalizePhone(rawPhone) : null },
      organizerEmail: p.organizer?.email?.toLowerCase() ?? null,
      locationType: location ? (VIDEO.test(location) ? 'online' : 'studio') : meetingUrl ? 'online' : null,
      location: location && !location.startsWith('integrations:') ? location : null,
      meetingUrl,
    },
  };
}
