// Full pipeline against the Neon TEST branch. Run with: npm run test:integration
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Db } from '@/db/client';
import { getCallerContext } from '@/pipeline/processCall';
import { runDailyJobs } from '@/jobs/daily';
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
  }, 300_000);

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

  it('T17: call-back reminder after the drop is cancelled when the caller rang back', async () => {
    expect(run.results.find((r) => r.id === 'sep-T17a')?.result.callbackReminder).toBe(true);
    const task = await one<{ status: string }>(
      `select t.status from tasks t join calls c on c.id = t.call_id where c.provider_call_id = 'sep-T17a'`,
    );
    expect(task.status).toBe('cancelled');
  });

  it('T08: missed call leaves an open call-back reminder on the dashboard', async () => {
    const task = await one<{ status: string; title: string }>(
      `select t.status, t.title from tasks t join calls c on c.id = t.call_id where c.provider_call_id = 'sep-T08'`,
    );
    expect(task).toEqual({ status: 'open', title: `Call back ${phoneFor('T08')} (missed call)` });
  });

  it('pipeline stages follow the outcomes; complaints stay off the board', async () => {
    const rows = (await db.query(`select coalesce(stage::text, 'none') as stage, count(*)::int as n from enquiries group by 1`)).rows;
    expect(Object.fromEntries(rows.map((r) => [r.stage, r.n]))).toEqual({ qualified: 11, lost: 5, new: 3, none: 1 });
  });

  it('qualified leads are spread evenly round-robin across the active designers', async () => {
    const designers = (await db.query(`select count(*)::int as n from designers where active`)).rows[0].n;
    const rows = (
      await db.query(`select assigned_designer_id, count(*)::int as n from enquiries where stage = 'qualified' group by 1`)
    ).rows;
    const counts = rows.map((r) => r.n);
    expect(rows.every((r) => r.assigned_designer_id)).toBe(true);
    expect(rows.length).toBe(Math.min(designers, 11));
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('qualified leads get a score with reasons', async () => {
    const t01 = await one<{ score: string; score_reasons: string[] }>(
      `select e.score, e.score_reasons from enquiries e join callers p on p.id = e.caller_id where p.phone = $1`,
      [phoneFor('T01')],
    );
    expect(t01.score).toBe('hot');
    expect(t01.score_reasons).toContain('Referred: Friend: Shruti Joshi (Aundh client)');
  });

  it('every step is on the lead timeline', async () => {
    const rows = (
      await db.query(
        `select a.kind from activities a join enquiries e on e.id = a.enquiry_id join callers p on p.id = e.caller_id
          where p.phone = $1 order by a.created_at, a.seq`,
        [phoneFor('T17')],
      )
    ).rows.map((r) => r.kind);
    expect(rows).toEqual(['system', 'stage_change', 'system', 'stage_change', 'assignment']);
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
    const event = MockVoiceProvider.parseEvent({
      type: 'call_ended', providerCallId: 'review-1', from: '+919800009999', startedAt: '2026-09-30T12:00:00+05:30',
      answeredAt: '2026-09-30T12:00:00+05:30', endedAt: '2026-09-30T12:03:00+05:30', durationSeconds: 180,
      turns: [{ speaker: 'caller', text: 'Hello?' }],
    });
    if (event.type !== 'call_ended') throw new Error('unexpected');
    const { handleCallEnded } = await import('@/pipeline/processCall');
    const result = await handleCallEnded({ db, extractor: new FixtureExtractor({}) }, event.interaction);
    expect(result.status).toBe('needs_review');
    expect(await one(`select count(*)::int as n from alerts where type = 'extraction_failed'`)).toEqual({ n: 1 });
  });

  it('greeting context: a known caller who rang back within 30 minutes resumes the enquiry', async () => {
    const deps = { db, extractor: new FixtureExtractor({}) };
    const resumed = await getCallerContext(deps, phoneFor('T17'), new Date('2026-09-22T14:30:00+05:30'));
    expect(resumed).toMatchObject({ known: true, name: 'Ritu Kapoor', resuming: { summary: expect.any(String) } });
    const later = await getCallerContext(deps, phoneFor('T17'), new Date('2026-09-23T10:00:00+05:30'));
    expect(later.resuming).toBeNull();
    const unknown = await getCallerContext(deps, '+919811111111', new Date());
    expect(unknown).toEqual({ known: false, name: null, nameConfirmed: false, resuming: null });
  });

  it('daily job: follow-up reminder after a stale consultation, created once', async () => {
    await db.query(
      `update enquiries set stage = 'consultation_done', stage_changed_at = '2026-09-10', last_activity_at = '2026-09-10'
        where caller_id = (select id from callers where phone = $1)`,
      [phoneFor('T05')],
    );
    const first = await runDailyJobs(db, new Date('2026-09-26T09:00:00+05:30'));
    const second = await runDailyJobs(db, new Date('2026-09-26T09:00:00+05:30'));
    expect(first.followUpsCreated).toBe(1);
    expect(second.followUpsCreated).toBe(0);
    const t = await one<{ assigned_to: string | null; title: string }>(
      `select t.assigned_to, t.title from tasks t join enquiries e on e.id = t.enquiry_id
        where t.type = 'follow_up' and e.caller_id = (select id from callers where phone = $1)`,
      [phoneFor('T05')],
    );
    expect(t.title).toMatch(/^Follow up after consultation/);
  });

  it('daily job: transcripts older than the retention period are deleted, metrics kept', async () => {
    // 30 days after 3 Oct reaches back to 3 Sep: only T01 (2 Sep) is older.
    const r = await runDailyJobs(db, new Date('2026-10-03T12:00:00+05:30'));
    expect(r.callsRedacted).toBe(1);
    const t01 = await one<{ transcript: unknown; outcome: string; redacted_at: Date | null; parsed: Record<string, unknown> }>(
      `select c.transcript, c.outcome, c.redacted_at, x.parsed from calls c
         join extractions x on x.call_id = c.id where c.provider_call_id = 'sep-T01'`,
    );
    expect(t01.transcript).toBeNull();
    expect(t01.redacted_at).not.toBeNull();
    expect(t01.outcome).toBe('qualified');
    expect(t01.parsed).not.toHaveProperty('caller');
    expect(t01.parsed).not.toHaveProperty('handoff_note');
    expect(t01.parsed).toHaveProperty('project');
  });
});
