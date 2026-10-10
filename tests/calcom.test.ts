import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseCalWebhook, verifyCalSignature } from '@/integrations/calcom';
import { bookingMessage, callSummaryMessage, safeText, type LeadFacts } from '@/integrations/messages';

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

const facts: LeadFacts = {
  name: 'Rahul <b>',
  phone: '+919876543210',
  area: 'Baner',
  scope: '2BHK full home',
  sizeSqft: 950,
  timeline: 'Move in by February',
  expectations: 'Warm, minimal, lots of storage',
  handoffNote: 'Wife will attend. Asked about price (deflected).',
  flags: ['Asked about price (deflected)'],
  leadUrl: 'https://front-desk-ayaan.vercel.app/leads/abc',
};

describe('Telegram messages', () => {
  it('booking message has slot, place, designer, facts and the lead link; HTML is escaped', () => {
    const m = bookingMessage(facts, { start: new Date('2026-10-11T05:30:00Z'), locationType: 'studio', designerName: 'Ananya Kulkarni' });
    expect(m).toContain('At the studio');
    expect(m).toContain('Ananya Kulkarni');
    expect(m).toContain('950 sq ft');
    expect(m).toContain('Rahul &lt;b&gt;');
    expect(m).toContain('https://front-desk-ayaan.vercel.app/leads/abc');
    expect(m).toMatch(/11 Oct/);
  });

  it('never forwards a price, even if the extraction note contains one', () => {
    expect(safeText('Budget around 8 lakh, wants teak')).toMatch(/withheld/);
    const m = callSummaryMessage({ ...facts, handoffNote: 'They said ₹5,00,000 max' }, { outcome: 'qualified', declineReason: null, openQuestion: null, complaint: null, afterHours: true });
    expect(m).not.toMatch(/₹|lakh/);
    expect(m).toContain('after hours');
  });
});
