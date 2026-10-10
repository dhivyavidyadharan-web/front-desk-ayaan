// Replays the September calls through the full pipeline into the TEST database branch.
// Usage: npm run replay   (wipes call data on DATABASE_URL_TEST first; config and designers are kept)
import { pathToFileURL } from 'node:url';
import { MockVoiceProvider } from '@/channels/voice/providers/mock';
import { createPool, type Db } from '@/db/client';
import { FixtureExtractor } from '@/llm/extractor';
import { handleCallEnded, type ProcessResult } from '@/pipeline/processCall';
import { SEPTEMBER_EXPECTED, SEPTEMBER_EXTRACTIONS, loadSeptemberEvents } from '../fixtures/september';

export async function resetCallData(db: Db): Promise<void> {
  await db.query(
    `truncate public.alerts, public.costs, public.actions, public.tasks, public.handoffs, public.bookings,
              public.extractions, public.calls, public.enquiries, public.callers`,
  );
}

export async function replaySeptember(db: Db, voice = new MockVoiceProvider('unused')) {
  const deps = { db, extractor: new FixtureExtractor(SEPTEMBER_EXTRACTIONS), voice, costRates: { voicePerMinuteInr: 6, llmInputPerMTokInr: 0, llmOutputPerMTokInr: 0 } };
  const results: { id: string; expected: string; result: ProcessResult }[] = [];
  for (const raw of loadSeptemberEvents()) {
    const event = MockVoiceProvider.parseEvent(raw);
    if (event.type !== 'call_ended') continue;
    // Process "now" = the call's end, as if it happened live.
    const at = event.interaction.endedAt ?? event.interaction.startedAt;
    const result = await handleCallEnded({ ...deps, now: () => at }, event.interaction);
    results.push({ id: event.interaction.providerCallId, expected: SEPTEMBER_EXPECTED[event.interaction.providerCallId] ?? '?', result });
  }
  return { results, voice };
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
    const { results, voice } = await replaySeptember(db);
    let ok = 0;
    for (const { id, expected, result } of results) {
      const match = result.outcome === expected;
      if (match) ok++;
      const extras = [...result.flags, result.priceLeak ? 'PRICE LEAK' : '', result.callbackPlaced ? 'callback placed' : '']
        .filter(Boolean)
        .join(', ');
      console.log(`${match ? '✓' : '✗'} ${id.replace('sep-', '').padEnd(5)} ${String(result.outcome).padEnd(19)} ${extras}`);
    }
    const counts = await db.query(
      `select (select count(*) from calls)::int as calls, (select count(*) from enquiries)::int as enquiries,
              (select count(*) from tasks where status in ('open','in_progress'))::int as open_tasks,
              (select count(*) from tasks where status = 'cancelled')::int as cancelled_tasks,
              (select count(*) from alerts where type = 'price_leak')::int as price_leaks`,
    );
    console.log(`\n${ok}/${results.length} outcomes as expected`);
    console.log('database:', counts.rows[0]);
    console.log('bot callbacks placed:', voice.outboundCalls.length);
  } finally {
    await db.end();
  }
}
