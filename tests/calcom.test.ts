import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseCalWebhook, verifyCalSignature } from '@/integrations/calcom';

const booking = (over: Record<string, unknown> = {}) => ({
  triggerEvent: 'BOOKING_CREATED',
  createdAt: '2026-10-10T10:00:00Z',
  payload: {
    uid: 'bk_1',
    title: 'Consultation',
    startTime: '2026-10-11T05:30:00Z',
    endTime: '2026-10-11T06:15:00Z',
    location: 'integrations:daily',
    attendees: [{ name: 'Rahul', email: 'Rahul.K@Example.com', timeZone: 'Asia/Kolkata' }],
    organizer: { name: 'Ananya Kulkarni', email: 'Ananya@aangan.example' },
    metadata: { videoCallUrl: 'https://app.cal.com/video/abc' },
    responses: { attendeePhoneNumber: { value: '98765 43210' } },
    ...over,
  },
});

describe('verifyCalSignature', () => {
  const body = JSON.stringify(booking());
  const sig = createHmac('sha256', 'shh').update(body).digest('hex');
  it('accepts the right signature', () => expect(verifyCalSignature(body, sig, 'shh')).toBe(true));
  it('rejects a wrong or missing one', () => {
    expect(verifyCalSignature(body, sig, 'other')).toBe(false);
    expect(verifyCalSignature(body, null, 'shh')).toBe(false);
    expect(verifyCalSignature(`${body} `, sig, 'shh')).toBe(false);
  });
});

describe('parseCalWebhook', () => {
  it('reads an online booking', () => {
    const e = parseCalWebhook(booking());
    expect(e).toMatchObject({
      kind: 'booked',
      booking: {
        uid: 'bk_1',
        attendee: { name: 'Rahul', email: 'rahul.k@example.com', phone: '+919876543210' },
        organizerEmail: 'ananya@aangan.example',
        locationType: 'online',
        location: null,
        meetingUrl: 'https://app.cal.com/video/abc',
      },
    });
  });

  it('reads a studio booking', () => {
    const e = parseCalWebhook(booking({ location: 'Aangan Studio, Pune', metadata: {} }));
    expect(e.kind === 'booked' && e.booking).toMatchObject({ locationType: 'studio', location: 'Aangan Studio, Pune', meetingUrl: null });
  });

  it('maps reschedule and cancel, ignores the rest', () => {
    expect(parseCalWebhook({ ...booking(), triggerEvent: 'BOOKING_RESCHEDULED' }).kind).toBe('rescheduled');
    expect(parseCalWebhook({ ...booking(), triggerEvent: 'BOOKING_CANCELLED' }).kind).toBe('cancelled');
    expect(parseCalWebhook({ ...booking(), triggerEvent: 'MEETING_ENDED' })).toEqual({ kind: 'ignored', reason: 'MEETING_ENDED' });
    expect(parseCalWebhook({ hello: 'world' }).kind).toBe('ignored');
  });
});
