// Booking → lead linking and Telegram alerts against the Neon TEST branch (Telegram faked).
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockVoiceProvider } from '@/channels/voice/providers/mock';
import { createPool, type Db } from '@/db/client';
import { parseCalWebhook } from '@/integrations/calcom';
import { TelegramNotifier } from '@/integrations/notifier';
import type { TelegramApi } from '@/integrations/telegram';
import { FixtureExtractor } from '@/llm/extractor';
import { recordCalEvent } from '@/pipeline/bookings';
import { handleCallEnded } from '@/pipeline/processCall';
import { extraction } from '../../fixtures/extractionBuilder';

const enabled = Boolean(process.env.DATABASE_URL_TEST);
const TEAM = '-100team';
const ANANYA_CHAT = '5550001';
const PHONE_A = '+919822200001'; // books during the call (webhook first)
const PHONE_B = '+919822200002'; // booking arrives after the call

class FakeTelegram implements TelegramApi {
  sent: { chatId: string; html: string; buttons?: { text: string; data: string }[] }[] = [];
  answered: string[] = [];
  async send(chatId: string, html: string, buttons?: { text: string; data: string }[]) {
    this.sent.push({ chatId, html, buttons });
    return { messageId: String(this.sent.length) };
  }
  async answerCallback(_id: string, text: string) {
    this.answered.push(text);
  }
  async clearButtons() {}
}

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

describe.skipIf(!enabled)('bookings and Telegram', () => {
  let db: Db;
  const tg = new FakeTelegram();
  let notifier: TelegramNotifier;

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
    return handleCallEnded({ db, extractor: new FixtureExtractor({ [id]: ex }), notifier }, e.interaction);
  };

  beforeAll(async () => {
    db = createPool(process.env.DATABASE_URL_TEST!);
    notifier = new TelegramNotifier(db, tg, { teamChatId: TEAM, baseUrl: 'https://app.example' });
    await db.query(`delete from public.bookings where attendee_phone in ($1, $2)`, [PHONE_A, PHONE_B]);
    await db.query(`delete from public.callers where phone in ($1, $2)`, [PHONE_A, PHONE_B]);
    await db.query(`update public.designers set telegram_chat_id = $1 where email = 'ananya@aangan.example'`, [ANANYA_CHAT]);
  });

  afterAll(async () => {
    await db?.query(`update public.designers set telegram_chat_id = null where email = 'ananya@aangan.example'`);
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

  it('team gets the call summary and the booking; Ananya gets the booking with an Acknowledge button', () => {
    const toTeam = tg.sent.filter((m) => m.chatId === TEAM).map((m) => m.html.split('\n')[0]);
    expect(toTeam).toEqual(['✅ <b>Qualified lead</b> · after hours', '📅 <b>New consultation</b>']);
    const toAnanya = tg.sent.filter((m) => m.chatId === ANANYA_CHAT);
    expect(toAnanya).toHaveLength(1);
    expect(toAnanya[0]!.buttons?.[0]?.data).toMatch(/^ack:[0-9a-f-]{36}$/);
    expect(toAnanya[0]!.html).toContain('Online (video)');
  });

  it('a retried booking webhook does not post again', async () => {
    const before = tg.sent.length;
    const again = await recordCalEvent(db, calEvent('bkA', PHONE_A));
    expect(again.linked).toBe(false);
    await notifier.bookingLinked(again.bookingId!);
    expect(tg.sent.length).toBe(before);
  });

  it('booking that arrives after the call links straight away', async () => {
    await callFrom(PHONE_B, 'bk-call-B');
    const r = await recordCalEvent(db, calEvent('bkB', PHONE_B));
    expect(r.linked).toBe(true);
  });

  it('cancelling moves the lead back to qualified and tells the team', async () => {
    const r = await recordCalEvent(db, calEvent('bkB', PHONE_B, 'BOOKING_CANCELLED'));
    expect(r.cancelled).toBe(true);
    await notifier.bookingCancelled(r.bookingId!);
    const stage = (await db.query(`select e.stage from enquiries e join callers c on c.id = e.caller_id where c.phone = $1`, [PHONE_B])).rows[0].stage;
    expect(stage).toBe('qualified');
    expect(tg.sent.at(-1)!.html).toContain('Consultation cancelled');
  });

  it('Acknowledge button marks the handoff and logs it on the lead', async () => {
    process.env.USE_TEST_DB = '1';
    process.env.TELEGRAM_BOT_TOKEN = 'itest';
    process.env.TELEGRAM_TEAM_CHAT_ID = TEAM;
    process.env.TELEGRAM_WEBHOOK_SECRET = 'itest-tg';
    const ack = tg.sent.find((m) => m.chatId === ANANYA_CHAT)!.buttons![0]!.data;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ ok: true, result: true })) as typeof fetch; // Telegram API calls
    try {
      const { POST } = await import('../../app/api/telegram/webhook/route');
      const res = await POST(
        new Request('https://x.test/api/telegram/webhook', {
          method: 'POST',
          headers: { 'x-telegram-bot-api-secret-token': 'itest-tg' },
          body: JSON.stringify({ callback_query: { id: 'cq1', data: ack, from: { first_name: 'Ananya' }, message: { message_id: 1, chat: { id: 5550001 } } } }),
        }),
      );
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = realFetch;
    }
    const h = (await db.query(`select acknowledged_at from handoffs where id = $1`, [ack.slice(4)])).rows[0];
    expect(h.acknowledged_at).not.toBeNull();
    const log = (await db.query(`select author_name, body from activities a join enquiries e on e.id = a.enquiry_id join callers c on c.id = e.caller_id where c.phone = $1 order by a.seq desc limit 1`, [PHONE_A])).rows[0];
    expect(log).toEqual({ author_name: 'Ananya Kulkarni', body: 'Acknowledged the booking on Telegram.' });
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
