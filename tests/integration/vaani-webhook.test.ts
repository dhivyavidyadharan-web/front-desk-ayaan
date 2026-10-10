// The real webhook route against the Neon TEST branch, with a Vaani-shaped payload.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Db } from '@/db/client';

const enabled = Boolean(process.env.DATABASE_URL_TEST);
const SECRET = 'itest-webhook-secret';
const PHONE = '+919811100001';

describe.skipIf(!enabled)('Vaani webhook route', () => {
  let db: Db;
  let POST: (req: Request, ctx: { params: Promise<{ provider: string }> }) => Promise<Response>;

  beforeAll(async () => {
    process.env.USE_TEST_DB = '1';
    process.env.VAANI_API_KEY = 'itest-key';
    process.env.VAANI_AGENT_ID = 'b34fd448-d4bd-4bb7-b3ff-95e9c7f85065';
    process.env.VAANI_WEBHOOK_SECRET = SECRET;
    delete process.env.GEMINI_API_KEY; // no live model calls in tests → needs_review path
    db = createPool(process.env.DATABASE_URL_TEST!);
    await db.query(`delete from public.calls where provider = 'vaani' and provider_call_id in ('itest-room-1', 'itest-room-2', 'vaani-dashboard-test-room')`);
    await db.query(`delete from public.voice_sessions where phone = $1`, [PHONE]);
    await db.query(`delete from public.callers where phone = $1`, [PHONE]);
    await db.query(
      `insert into public.voice_sessions (provider, provider_call_id, phone, name, language, consent_at)
       values ('vaani', 'itest-room-1', $1, 'Rahul', 'en', now()), ('vaani', 'itest-room-2', $1, 'Rahul', 'en', now())`,
      [PHONE],
    );
    ({ POST } = await import('../../app/api/voice/[provider]/webhook/route'));
  });

  afterAll(async () => {
    await db?.end();
  });

  const call = (body: unknown, token = SECRET) =>
    POST(new Request(`https://example.test/api/voice/vaani/webhook?token=${token}`, { method: 'POST', body: JSON.stringify(body) }), {
      params: Promise.resolve({ provider: 'vaani' }),
    });

  const finished = (room: string, transcript: string) => ({
    event: 'call_postprocessing',
    call_id: room,
    timestamp: '2026-10-10T16:10:00+00:00',
    data: { call_id: room, call_duration: 90_000, transcript },
  });

  it('rejects a bad token', async () => {
    expect((await call(finished('itest-room-1', 'USER: hi'), 'wrong')).status).toBe(401);
  });

  it('matches the browser call to the caller from the session and stores it', async () => {
    const res = await call(finished('itest-room-1', 'AGENT: Hi Rahul.\nUSER: I have a 2BHK in Baner.'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('needs_review'); // no Gemini key in tests
    const row = (await db.query(`select from_number, duration_seconds, jsonb_array_length(transcript) as turns from calls where provider_call_id = 'itest-room-1'`)).rows[0];
    expect(row).toEqual({ from_number: PHONE, duration_seconds: 90, turns: 2 });
  });

  it('a session where the caller never spoke becomes a call-back reminder', async () => {
    const body = await (await call(finished('itest-room-2', 'AGENT: Hello? Are you there?'))).json();
    expect(body).toMatchObject({ outcome: 'missed', callbackReminder: true });
  });

  it('keeps calls started outside /talk (e.g. Vaani\'s Test button) under a placeholder number', async () => {
    const res = await call(finished('vaani-dashboard-test-room', 'AGENT: Hello.\nUSER: I have a 3BHK in Aundh.'));
    expect(res.status).toBe(200);
    const row = (await db.query(`select from_number from calls where provider_call_id = 'vaani-dashboard-test-room'`)).rows[0];
    expect(row.from_number).toMatch(/^\+999\d{9}$/);
  });

  it('ignores lifecycle events', async () => {
    expect(await (await call({ event: 'call_ringing', room_name: 'itest-room-1' })).json()).toEqual({ ok: true, ignored: 'call_ringing' });
  });
});
