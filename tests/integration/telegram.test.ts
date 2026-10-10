// Designer alerts on Telegram, against the Neon TEST branch (Telegram API faked).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockVoiceProvider } from '@/channels/voice/providers/mock';
import { createPool, type Db } from '@/db/client';
import { parseCalWebhook } from '@/integrations/calcom';
import { TelegramNotifier } from '@/integrations/notifier';
import type { TelegramApi } from '@/integrations/telegram';
import { designerLinkCode } from '@/integrations/telegramLink';
import { FixtureExtractor } from '@/llm/extractor';
import { recordCalEvent } from '@/pipeline/bookings';
import { handleCallEnded } from '@/pipeline/processCall';
import { extraction } from '../../fixtures/extractionBuilder';

const enabled = Boolean(process.env.DATABASE_URL_TEST);
const SECRET = 'itest-tg-secret';
const PHONE_Q = '+919833300001'; // qualified, no booking
const PHONE_B = '+919833300002'; // books during the call
const PHONE_D = '+919833300003'; // declined

class FakeTelegram implements TelegramApi {
  sent: { chatId: string; html: string; buttons?: { text: string; data: string }[] }[] = [];
  async send(chatId: string, html: string, buttons?: { text: string; data: string }[]) {
    this.sent.push({ chatId, html, buttons });
    return { messageId: String(this.sent.length) };
  }
  async answerCallback() {}
  async clearButtons() {}
}

describe.skipIf(!enabled)('designer alerts on Telegram', () => {
  let db: Db;
  const tg = new FakeTelegram();
  let notifier: TelegramNotifier;
  const chatOf = new Map<string, string>(); // designer id → fake chat id

  const call = async (phone: string, id: string, patch: Parameters<typeof extraction>[0] = {}) => {
    const e = MockVoiceProvider.parseEvent({
      type: 'call_ended', providerCallId: id, from: phone,
      startedAt: '2026-10-10T21:40:00+05:30', answeredAt: '2026-10-10T21:40:00+05:30', endedAt: '2026-10-10T21:45:00+05:30',
      durationSeconds: 300, turns: [{ speaker: 'caller', text: 'Hi, I have a 2BHK in Baner.' }],
    });
    if (e.type !== 'call_ended') throw new Error('unexpected');
    const ex = extraction({ caller: { name: 'Test Client', phone, email: `${id}@example.com` }, project: { area_locality: 'Baner', size_sqft: 950 }, ...patch });
    return handleCallEnded({ db, extractor: new FixtureExtractor({ [id]: ex }), notifier }, e.interaction);
  };
  const booking = (uid: string, phone: string, trigger = 'BOOKING_CREATED') =>
    parseCalWebhook({
      triggerEvent: trigger,
      payload: {
        uid, startTime: '2026-10-13T05:30:00Z', location: 'integrations:daily',
        attendees: [{ name: 'Test Client', email: `${uid}@example.com` }], organizer: { email: 'meera@aangan.example' },
        responses: { attendeePhoneNumber: { value: phone } },
      },
    });

  beforeAll(async () => {
    db = createPool(process.env.DATABASE_URL_TEST!);
    notifier = new TelegramNotifier(db, tg, { baseUrl: 'https://app.example' });
    await db.query(`delete from public.bookings where attendee_phone = any($1)`, [[PHONE_Q, PHONE_B, PHONE_D]]);
    await db.query(`delete from public.callers where phone = any($1)`, [[PHONE_Q, PHONE_B, PHONE_D]]);
    const ds = (await db.query<{ id: string }>(`select id from public.designers where active order by name`)).rows;
    for (const [i, d] of ds.entries()) {
      chatOf.set(d.id, `90000${i}`);
      await db.query(`update public.designers set telegram_chat_id = $2 where id = $1`, [d.id, `90000${i}`]);
    }
  });

  afterAll(async () => {
    await db?.query(`update public.designers set telegram_chat_id = null`);
    await db?.end();
  });

  it('a qualified lead reaches its assigned designer with the snapshot and transcript link', async () => {
    const r = await call(PHONE_Q, 'tg-call-q');
    expect(r.outcome).toBe('qualified');
    const designer = (await db.query(`select e.assigned_designer_id as id from enquiries e join callers c on c.id = e.caller_id where c.phone = $1`, [PHONE_Q])).rows[0].id;
    const msg = tg.sent.at(-1)!;
    expect(msg.chatId).toBe(chatOf.get(designer));
    expect(msg.html).toContain('New qualified lead for you');
    expect(msg.html).toContain('Baner');
    expect(msg.html).toContain('950 sq ft');
    expect(msg.html).toMatch(/https:\/\/app\.example\/transcripts\/[0-9a-f-]{36}/);
  });

  it('a declined call sends nothing', async () => {
    const before = tg.sent.length;
    const r = await call(PHONE_D, 'tg-call-d', { project: { area_locality: 'Nashik', in_service_area: 'no' } });
    expect(r.outcome).toBe('declined');
    expect(tg.sent.length).toBe(before);
  });

  it('booked during the call: one "consultation booked" message to the booked designer, not two', async () => {
    await recordCalEvent(db, booking('tg-bk', PHONE_B)); // webhook arrives first
    const before = tg.sent.length;
    await call(PHONE_B, 'tg-call-b');
    const mine = tg.sent.slice(before);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.html).toContain('Consultation booked with you');
    const meera = (await db.query(`select telegram_chat_id from designers where email = 'meera@aangan.example'`)).rows[0].telegram_chat_id;
    expect(mine[0]!.chatId).toBe(meera);
    expect(mine[0]!.buttons?.[0]?.data).toMatch(/^ack:[0-9a-f-]{36}$/);
  });

  it('a retried webhook never posts twice; a cancellation tells the designer', async () => {
    const before = tg.sent.length;
    const again = await recordCalEvent(db, booking('tg-bk', PHONE_B));
    await notifier.bookingLinked(again.bookingId!);
    expect(tg.sent.length).toBe(before);
    const cancelled = await recordCalEvent(db, booking('tg-bk', PHONE_B, 'BOOKING_CANCELLED'));
    await notifier.bookingCancelled(cancelled.bookingId!);
    expect(tg.sent.at(-1)!.html).toContain('Consultation cancelled');
  });

  it('a designer’s personal link connects them; a forged one does not; Acknowledge logs on the lead', async () => {
    process.env.USE_TEST_DB = '1';
    process.env.TELEGRAM_BOT_TOKEN = 'itest';
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    const replies: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.text) replies.push(body.text);
      return Response.json({ ok: true, result: { message_id: 1 } });
    }) as typeof fetch;
    try {
      const { POST } = await import('../../app/api/telegram/webhook/route');
      const post = (update: unknown) =>
        POST(new Request('https://x.test', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': SECRET }, body: JSON.stringify(update) }));
      const kabir = (await db.query(`select id from designers where email = 'kabir@aangan.example'`)).rows[0].id;

      await post({ message: { chat: { id: 777123, type: 'private' }, text: `/start ${designerLinkCode(kabir, SECRET)}` } });
      expect((await db.query(`select telegram_chat_id from designers where id = $1`, [kabir])).rows[0].telegram_chat_id).toBe('777123');
      expect(replies.at(-1)).toMatch(/^Hi Kabir! You're connected/);

      await post({ message: { chat: { id: 666, type: 'private' }, text: `/start ${designerLinkCode(kabir, 'guess')}` } });
      expect((await db.query(`select telegram_chat_id from designers where id = $1`, [kabir])).rows[0].telegram_chat_id).toBe('777123');

      const ack = tg.sent.find((m) => m.buttons)!.buttons![0]!.data;
      await post({ callback_query: { id: 'cq', data: ack, message: { message_id: 1, chat: { id: 1 } } } });
      expect((await db.query(`select acknowledged_at from handoffs where id = $1`, [ack.slice(4)])).rows[0].acknowledged_at).not.toBeNull();
      const log = (
        await db.query(`select body from activities a join enquiries e on e.id = a.enquiry_id join callers c on c.id = e.caller_id where c.phone = $1 order by a.seq desc limit 1`, [PHONE_B])
      ).rows[0];
      expect(log.body).toBe('Acknowledged the booking on Telegram.');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
