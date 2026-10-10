// Booking → lead linking against the Neon TEST branch.
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockVoiceProvider } from '@/channels/voice/providers/mock';
import { createPool, type Db } from '@/db/client';
import { parseCalWebhook } from '@/integrations/calcom';
import { FixtureExtractor } from '@/llm/extractor';
import { recordCalEvent } from '@/pipeline/bookings';
import { handleCallEnded } from '@/pipeline/processCall';
import { extraction } from '../../fixtures/extractionBuilder';

const enabled = Boolean(process.env.DATABASE_URL_TEST);
const PHONE_A = '+919822200001'; // books during the call (webhook first)
const PHONE_B = '+919822200002'; // booking arrives after the call

const calEvent = (uid: string, phone: string, trigger = 'BOOKING_CREATED') =>
  parseCalWebhook({
    triggerEvent: trigger,
    payload: {
      uid,
      startTime: '2026-10-12T06:30:00Z',
      endTime: '2026-10-12T07:15:00Z',
      location: 'integrations:daily',
      attendees: [{ name: 'Test Caller', email: `${uid}@example.com` }],
      organizer: { name: 'Ananya Kulkarni', email: 'ananya@aangan.example' },
      metadata: { videoCallUrl: `https://app.cal.com/video/${uid}` },
      responses: { attendeePhoneNumber: { value: phone } },
    },
  });

describe.skipIf(!enabled)('cal.com bookings', () => {
  let db: Db;

  const callFrom = async (phone: string, id: string) => {
    const e = MockVoiceProvider.parseEvent({
      type: 'call_ended',
      providerCallId: id,
      from: phone,
      startedAt: '2026-10-10T21:40:00+05:30',
      answeredAt: '2026-10-10T21:40:00+05:30',
      endedAt: '2026-10-10T21:45:00+05:30',
      durationSeconds: 300,
      turns: [{ speaker: 'caller', text: 'I have a 2BHK in Baner.' }],
    });
    if (e.type !== 'call_ended') throw new Error('unexpected');
    const ex = extraction({ caller: { name: 'Test Caller', phone, email: `${id}@example.com` }, project: { area_locality: 'Baner', size_sqft: 950 } });
    return handleCallEnded({ db, extractor: new FixtureExtractor({ [id]: ex }) }, e.interaction);
  };

  beforeAll(async () => {
    db = createPool(process.env.DATABASE_URL_TEST!);
    await db.query(`delete from public.bookings where attendee_phone in ($1, $2)`, [PHONE_A, PHONE_B]);
    await db.query(`delete from public.callers where phone in ($1, $2)`, [PHONE_A, PHONE_B]);
  });

  afterAll(async () => {
    await db?.end();
  });

  it('booking made during the call waits, then links when the call is processed', async () => {
    const first = await recordCalEvent(db, calEvent('bkA', PHONE_A));
    expect(first.linked).toBe(false); // no lead yet

    const call = await callFrom(PHONE_A, 'bk-call-A');
    expect(call.outcome).toBe('qualified');
    const lead = (
      await db.query(
        `select e.stage, d.name as designer from enquiries e join callers c on c.id = e.caller_id
           left join designers d on d.id = e.assigned_designer_id where c.phone = $1`,
        [PHONE_A],
      )
    ).rows[0];
    expect(lead).toEqual({ stage: 'consultation_booked', designer: 'Ananya Kulkarni' }); // cal.com picked Ananya
  });

  it('booking that arrives after the call links straight away', async () => {
    await callFrom(PHONE_B, 'bk-call-B');
    const r = await recordCalEvent(db, calEvent('bkB', PHONE_B));
    expect(r.linked).toBe(true);
  });

  it('a retried booking webhook changes nothing', async () => {
    const again = await recordCalEvent(db, calEvent('bkA', PHONE_A));
    expect(again.linked).toBe(false);
    expect((await db.query(`select count(*)::int as n from bookings where calcom_booking_uid = 'bkA'`)).rows[0].n).toBe(1);
  });

  it('cancelling moves the lead back to qualified', async () => {
    const r = await recordCalEvent(db, calEvent('bkB', PHONE_B, 'BOOKING_CANCELLED'));
    expect(r.cancelled).toBe(true);
    const stage = (await db.query(`select e.stage from enquiries e join callers c on c.id = e.caller_id where c.phone = $1`, [PHONE_B])).rows[0].stage;
    expect(stage).toBe('qualified');
  });

  it('cal.com webhook route rejects an unsigned request and accepts a signed one', async () => {
    process.env.CALCOM_WEBHOOK_SECRET = 'itest-cal';
    const { POST } = await import('../../app/api/calcom/webhook/route');
    const body = JSON.stringify({ triggerEvent: 'MEETING_ENDED', payload: {} });
    expect((await POST(new Request('https://x.test', { method: 'POST', body }))).status).toBe(401);
    const sig = createHmac('sha256', 'itest-cal').update(body).digest('hex');
    const ok = await POST(new Request('https://x.test', { method: 'POST', body, headers: { 'x-cal-signature-256': sig } }));
    expect(await ok.json()).toEqual({ ok: true, ignored: 'not a booking payload' });
  });
});
