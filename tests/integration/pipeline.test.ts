// Full pipeline against the Neon TEST branch. Run with: npm run test:integration
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Db } from '@/db/client';
import { getCallerContext } from '@/pipeline/processCall';
import { FixtureExtractor } from '@/llm/extractor';
import { MockVoiceProvider } from '@/channels/voice/providers/mock';
import { replaySeptember, resetCallData, testDbUrl } from '../../scripts/replay';
import { phoneFor } from '../../fixtures/september';

const enabled = Boolean(process.env.DATABASE_URL_TEST);

describe.skipIf(!enabled)('September replay through the pipeline', () => {
  let db: Db;
  let run: Awaited<ReturnType<typeof replaySeptember>>;

  beforeAll(async () => {
    db = createPool(testDbUrl());
    await resetCallData(db);
    run = await replaySeptember(db);
  }, 120_000);

  afterAll(async () => {
    await db?.end();
  });

  const one = async <T>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as T;

  it('every call gets its expected outcome', () => {
    const wrong = run.results.filter((r) => r.result.outcome !== r.expected).map((r) => `${r.id}: ${r.result.outcome}`);
    expect(wrong).toEqual([]);
  });

  it('stores 21 calls as 20 enquiries (T17 dropped call + callback is one enquiry)', async () => {
    expect(await one('select count(*)::int as n from calls')).toEqual({ n: 21 });
    expect(await one('select count(*)::int as n from enquiries')).toEqual({ n: 20 });
    const t17 = await one<{ calls: number; outcome: string }>(
      `select count(c.*)::int as calls, e.outcome from enquiries e join calls c on c.enquiry_id = e.id
        join callers p on p.id = e.caller_id where p.phone = $1 group by e.outcome`,
      [phoneFor('T17')],
    );
    expect(t17).toEqual({ calls: 2, outcome: 'qualified' });
  });

  it('T17: bot callback was placed after the drop, then cancelled when the caller rang back', async () => {
    expect(run.voice.outboundCalls.map((c) => c.to)).toContain(phoneFor('T17'));
    const task = await one<{ status: string }>(
      `select t.status from tasks t join calls c on c.id = t.call_id where c.provider_call_id = 'sep-T17a'`,
    );
    expect(task.status).toBe('cancelled');
  });

  it('T08: missed call leaves an open callback task', async () => {
    const task = await one<{ status: string; attempts: number }>(
      `select t.status, t.attempts from tasks t join calls c on c.id = t.call_id where c.provider_call_id = 'sep-T08'`,
    );
    expect(task).toEqual({ status: 'in_progress', attempts: 1 });
  });

  it('unsure leads land in the queue with their question', async () => {
    const rows = (await db.query(`select question from tasks where type = 'unsure' order by created_at`)).rows;
    expect(rows).toHaveLength(2);
  });

  it('T09 complaint raises an alert and a complaint task', async () => {
    expect(await one(`select count(*)::int as n from alerts where type = 'complaint'`)).toEqual({ n: 1 });
    expect(await one(`select count(*)::int as n from tasks where type = 'complaint'`)).toEqual({ n: 1 });
  });

  it('price-leak scan flags the human front desk lines in T10 and T13 only', async () => {
    const rows = (
      await db.query(`select c.provider_call_id from alerts a join calls c on c.id = a.call_id where a.type = 'price_leak' order by 1`)
    ).rows.map((r) => r.provider_call_id);
    expect(rows).toEqual(['sep-T10', 'sep-T13']);
  });

  it('outside-hours calls are marked (T07 9:44am, T08 10:47pm, T20 9:15am)', async () => {
    const rows = (await db.query(`select provider_call_id from calls where outside_hours order by 1`)).rows.map((r) => r.provider_call_id);
    expect(rows).toEqual(['sep-T07', 'sep-T08', 'sep-T20']);
  });

  it('caller names and referral sources are saved', async () => {
    const p = await one<{ name: string; referral_source: string }>('select name, referral_source from callers where phone = $1', [phoneFor('T01')]);
    expect(p).toEqual({ name: 'Priya', referral_source: 'Friend: Shruti Joshi (Aundh client)' });
  });

  it('replaying the same webhook twice changes nothing', async () => {
    const before = await one('select count(*)::int as n from calls');
    const again = await replaySeptember(db);
    expect(again.results.every((r) => r.result.duplicate)).toBe(true);
    expect(await one('select count(*)::int as n from calls')).toEqual(before);
  });

  it('a call with no extraction goes to needs_review with an alert', async () => {
    const voice = new MockVoiceProvider('unused');
    const event = MockVoiceProvider.parseEvent({
      type: 'call_ended', providerCallId: 'review-1', from: '+919800009999', startedAt: '2026-09-30T12:00:00+05:30',
      answeredAt: '2026-09-30T12:00:00+05:30', endedAt: '2026-09-30T12:03:00+05:30', durationSeconds: 180,
      turns: [{ speaker: 'caller', text: 'Hello?' }],
    });
    if (event.type !== 'call_ended') throw new Error('unexpected');
    const { handleCallEnded } = await import('@/pipeline/processCall');
    const result = await handleCallEnded({ db, extractor: new FixtureExtractor({}), voice }, event.interaction);
    expect(result.status).toBe('needs_review');
    expect(await one(`select count(*)::int as n from alerts where type = 'extraction_failed'`)).toEqual({ n: 1 });
  });

  it('greeting context: a known caller who rang back within 30 minutes resumes the enquiry', async () => {
    const deps = { db, extractor: new FixtureExtractor({}), voice: new MockVoiceProvider('unused') };
    const resumed = await getCallerContext(deps, phoneFor('T17'), new Date('2026-09-22T14:30:00+05:30'));
    expect(resumed).toMatchObject({ known: true, name: 'Ritu Kapoor', resuming: { summary: expect.any(String) } });
    const later = await getCallerContext(deps, phoneFor('T17'), new Date('2026-09-23T10:00:00+05:30'));
    expect(later.resuming).toBeNull();
    const unknown = await getCallerContext(deps, '+919811111111', new Date());
    expect(unknown).toEqual({ known: false, name: null, nameConfirmed: false, resuming: null });
  });
});
