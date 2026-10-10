import { getPool, type Db } from '@/db/client';
import { TelegramClient, telegramConfigFromEnv } from '@/integrations/telegram';
import { parseLinkCode } from '@/integrations/telegramLink';

export const runtime = 'nodejs';

type Update = {
  message?: { chat: { id: number; type: string; title?: string }; text?: string; from?: { first_name?: string } };
  callback_query?: { id: string; data?: string; from?: { first_name?: string }; message?: { message_id: number; chat: { id: number } } };
};

// Telegram posts updates here (scripts/telegram-setup.mts registers it with secret_token).
// Always answers 200 for valid calls so Telegram doesn't retry.
export async function POST(req: Request) {
  const cfg = telegramConfigFromEnv();
  if (!cfg || req.headers.get('x-telegram-bot-api-secret-token') !== cfg.webhookSecret) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const update = (await req.json().catch(() => ({}))) as Update;
  const db = getPool();
  const api = new TelegramClient(cfg.botToken);

  if (update.callback_query) await acknowledge(db, api, update.callback_query);
  else if (update.message?.text) await command(db, api, cfg.webhookSecret, update.message);
  return Response.json({ ok: true });
}

async function command(db: Db, api: TelegramClient, secret: string, m: NonNullable<Update['message']>) {
  const [cmd = '', arg = ''] = m.text!.trim().split(/\s+/, 2);
  const chatId = String(m.chat.id);
  const name = cmd.split('@')[0]; // "/team@AanganBot" in groups

  if (name === '/start') {
    const target = arg ? parseLinkCode(arg, secret) : null;
    if (target?.kind === 'designer') {
      const r = await db.query<{ name: string }>(`update public.designers set telegram_chat_id = $2 where id = $1 returning name`, [target.designerId, chatId]);
      const d = r.rows[0];
      await api.send(chatId, d ? `Hi ${d.name.split(' ')[0]}! You're connected. You'll get a message here whenever a consultation is booked with you.` : 'This link is no longer valid. Ask the studio for a new one.');
      return;
    }
    await api.send(chatId, arg ? 'This link isn’t valid. Ask the studio for your personal link.' : 'Hi! This bot sends Aangan Studio designers their consultation bookings. Ask the studio for your personal link.');
    return;
  }

  if (name === '/team') {
    if (m.chat.type === 'private') return void (await api.send(chatId, 'Send this in the team group, not here.'));
    if (parseLinkCode(arg, secret)?.kind !== 'team') return void (await api.send(chatId, 'That code isn’t valid. Copy the /team message from the dashboard’s Settings page.'));
    await db.query(`update public.config set value = to_jsonb($1::text), updated_at = now() where key = 'telegram_team_chat_id'`, [chatId]);
    await api.send(chatId, 'Done. This group will now get every call summary and every booked consultation.');
  }
}

async function acknowledge(db: Db, api: TelegramClient, q: NonNullable<Update['callback_query']>) {
  const match = q.data?.match(/^ack:([0-9a-f-]{36})$/i);
  if (!match) return;
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
}
