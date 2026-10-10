// Replays the September calls through the full pipeline into the TEST database branch.
// Usage: npm run replay   (wipes call data on DATABASE_URL_TEST first; config and designers are kept)
import { pathToFileURL } from 'node:url';
import { MockVoiceProvider } from '@/channels/voice/providers/mock';
import { createPool, type Db } from '@/db/client';
import { FixtureExtractor } from '@/llm/extractor';
import { handleCallEnded, type ProcessResult } from '@/pipeline/processCall';
import { parseCalWebhook } from '@/integrations/calcom';
import { recordCalEvent } from '@/pipeline/bookings';
import { SEPTEMBER_EXPECTED, SEPTEMBER_EXTRACTIONS, loadSeptemberEvents, phoneFor } from '../fixtures/september';

export async function resetCallData(db: Db): Promise<void> {
  await db.query(
    `truncate public.activities, public.alerts, public.costs, public.actions, public.tasks, public.handoffs, public.bookings,
              public.extractions, public.calls, public.enquiries, public.callers`,
  );
  // Replays use historical timestamps, so round-robin must start fresh.
  await db.query('update public.designers set last_assigned_at = null');
}

export async function replaySeptember(db: Db) {
  const deps = { db, extractor: new FixtureExtractor(SEPTEMBER_EXTRACTIONS), costRates: { voicePerMinuteInr: 6, llmInputPerMTokInr: 0, llmOutputPerMTokInr: 0 } };
  const results: { id: string; expected: string; result: ProcessResult }[] = [];
  for (const raw of loadSeptemberEvents()) {
    const event = MockVoiceProvider.parseEvent(raw);
    if (event.type !== 'call_ended') continue;
    // Process "now" = the call's end, as if it happened live.
    const at = event.interaction.endedAt ?? event.interaction.startedAt;
    const result = await handleCallEnded({ ...deps, now: () => at }, event.interaction);
    results.push({ id: event.interaction.providerCallId, expected: SEPTEMBER_EXPECTED[event.interaction.providerCallId] ?? '?', result });
  }
  return { results };
}

/** Demo only: two upcoming consultations booked through the real cal.com path (fictional designers). */
export async function addDemoBookings(db: Db) {
  const at = (days: number, hourIst: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(hourIst - 6, 30, 0, 0); // IST = UTC+5:30, so 11:00 IST = 05:30 UTC
    return d.toISOString();
  };
  const demo = [
    { uid: 'demo-T01', phone: phoneFor('T01'), start: at(1, 11), location: 'integrations:daily', organizer: 'ananya@aangan.example' },
    { uid: 'demo-T05', phone: phoneFor('T05'), start: at(3, 16), location: 'Aangan Studio, Pune', organizer: 'rohan@aangan.example' },
  ];
  for (const b of demo) {
    await recordCalEvent(
      db,
      parseCalWebhook({
        triggerEvent: 'BOOKING_CREATED',
        payload: {
          uid: b.uid,
          startTime: b.start,
          endTime: new Date(new Date(b.start).getTime() + 45 * 60_000).toISOString(),
          location: b.location,
          attendees: [{ name: 'Demo client', email: `${b.uid}@example.com` }],
          organizer: { email: b.organizer },
          metadata: b.location.startsWith('integrations:') ? { videoCallUrl: `https://app.cal.com/video/${b.uid}` } : {},
          responses: { attendeePhoneNumber: { value: b.phone } },
        },
      }),
    );
  }
}

export function testDbUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is not set (.env.local)');
  if (url === process.env.DATABASE_URL) throw new Error('DATABASE_URL_TEST must not point at the main database');
  return url;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = createPool(testDbUrl());
  try {
    await resetCallData(db);
    const { results } = await replaySeptember(db);
    await addDemoBookings(db);
    let ok = 0;
    for (const { id, expected, result } of results) {
      const match = result.outcome === expected;
      if (match) ok++;
      const extras = [...result.flags, result.priceLeak ? 'PRICE LEAK' : '', result.callbackReminder ? 'call-back reminder' : '']
        .filter(Boolean)
        .join(', ');
      console.log(`${match ? '✓' : '✗'} ${id.replace('sep-', '').padEnd(5)} ${String(result.outcome).padEnd(19)} ${extras}`);
    }
    const counts = await db.query(
      `select (select count(*) from calls)::int as calls, (select count(*) from enquiries)::int as enquiries,
              (select count(*) from tasks where status in ('open','in_progress'))::int as open_tasks,
              (select count(*) from tasks where status = 'cancelled')::int as cancelled_tasks,
              (select count(*) from alerts where type = 'price_leak')::int as price_leaks,
              (select count(*) from enquiries where assigned_designer_id is not null)::int as assigned_leads`,
    );
    console.log(`\n${ok}/${results.length} outcomes as expected`);
    console.log('database:', counts.rows[0]);
    const stages = await db.query(`select coalesce(stage::text, 'complaint') as stage, count(*)::int as n from enquiries group by 1 order by 1`);
    console.log('pipeline:', Object.fromEntries(stages.rows.map((r) => [r.stage, r.n])));
  } finally {
    await db.end();
  }
}
