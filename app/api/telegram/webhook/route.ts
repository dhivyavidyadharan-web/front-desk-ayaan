import { getPool } from '@/db/client';
import { TelegramClient, telegramConfigFromEnv } from '@/integrations/telegram';

export const runtime = 'nodejs';

// Telegram sends button presses here (setWebhook with secret_token = TELEGRAM_WEBHOOK_SECRET).
// Always answers 200 so Telegram doesn't retry.
export async function POST(req: Request) {
  const cfg = telegramConfigFromEnv();
  if (!cfg || req.headers.get('x-telegram-bot-api-secret-token') !== cfg.webhookSecret) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const update = (await req.json().catch(() => ({}))) as {
    callback_query?: { id: string; data?: string; from?: { first_name?: string }; message?: { message_id: number; chat: { id: number } } };
  };
  const q = update.callback_query;
  const match = q?.data?.match(/^ack:([0-9a-f-]{36})$/i);
  if (!q || !match) return Response.json({ ok: true });

  const db = getPool();
  const api = new TelegramClient(cfg.botToken);
  const r = await db.query<{ enquiry_id: string | null; designer_name: string | null }>(
    `update public.handoffs h set acknowledged_at = now()
      where h.id = $1 and h.acknowledged_at is null
      returning (select b.enquiry_id from public.bookings b where b.id = h.booking_id) as enquiry_id,
                (select d.name from public.designers d where d.id = h.designer_id) as designer_name`,
    [match[1]],
  );
  const row = r.rows[0];
  if (row?.enquiry_id) {
    await db.query(
      `insert into public.activities (enquiry_id, author_name, kind, body) values ($1, $2, 'system', 'Acknowledged the booking on Telegram.')`,
      [row.enquiry_id, row.designer_name ?? q.from?.first_name ?? 'Designer'],
    );
  }
  await api.answerCallback(q.id, row ? 'Marked as acknowledged ✓' : 'Already acknowledged');
  if (q.message) await api.clearButtons(String(q.message.chat.id), String(q.message.message_id)).catch(() => {});
  return Response.json({ ok: true });
}
