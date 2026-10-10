import { getPool } from '@/db/client';
import { parseCalWebhook, verifyCalSignature } from '@/integrations/calcom';
import { notifierFromEnv } from '@/integrations/notifier';
import { recordCalEvent } from '@/pipeline/bookings';

export const runtime = 'nodejs';

// cal.com → Webhooks: subscriber URL https://<app>/api/calcom/webhook, secret = CALCOM_WEBHOOK_SECRET,
// events: Booking created, rescheduled, cancelled.
export async function POST(req: Request) {
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  const raw = await req.text();
  if (!secret || !verifyCalSignature(raw, req.headers.get('x-cal-signature-256'), secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  const event = parseCalWebhook(json);
  if (event.kind === 'ignored') return Response.json({ ok: true, ignored: event.reason });

  const db = getPool();
  const result = await recordCalEvent(db, event);
  const notifier = notifierFromEnv(db);
  if (notifier && result.bookingId) {
    if (result.linked) await notifier.bookingLinked(result.bookingId);
    if (result.cancelled) await notifier.bookingCancelled(result.bookingId);
  }
  return Response.json({ ok: true, ...result });
}
