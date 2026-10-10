// Loads the September calls (and two upcoming demo consultations) into the LIVE database so the
// dashboard has something to show. Safe to re-run: it only removes and reloads demo rows, and it
// refuses to run once real calls exist.
// Usage: npm run demo:load
import { createPool } from '../src/db/client';
import { loadSeptemberEvents, phoneFor } from '../fixtures/september';
import { addDemoBookings, replaySeptember } from './replay';

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (.env.local)');
const db = createPool(url);

try {
  const real = await db.query<{ n: number }>(`select count(*)::int as n from public.calls where provider <> 'mock'`);
  if (real.rows[0]!.n > 0) {
    console.error(`Refusing: the live database already has ${real.rows[0]!.n} real calls. Demo data is only for an empty dashboard.`);
    process.exit(1);
  }

  const demoPhones = [...new Set(loadSeptemberEvents().map((e) => e.from))];
  // Remove any earlier demo load: calls first, then the demo callers (their leads, bookings,
  // reminders and timeline go with them).
  await db.query(`delete from public.calls where provider = 'mock' and provider_call_id like 'sep-%'`);
  await db.query(`delete from public.bookings where calcom_booking_uid like 'demo-%'`);
  await db.query(`delete from public.callers where phone = any($1)`, [demoPhones]);
  // The replay uses September timestamps, so round-robin starts fresh.
  await db.query(`update public.designers set last_assigned_at = null`);

  const { results } = await replaySeptember(db);
  await addDemoBookings(db);
  const ok = results.filter((r) => r.result.outcome === r.expected).length;
  console.log(`Loaded ${results.length} demo calls (${ok}/${results.length} outcomes as expected) and 2 upcoming consultations.`);
  console.log(`Demo callers use made-up numbers like ${phoneFor('T01')}.`);
} finally {
  await db.end();
}
