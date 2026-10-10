// The Telegram webhook's /start and /team flows against the Neon TEST branch (Telegram API faked).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Db } from '@/db/client';
import { designerLinkCode, teamLinkCode } from '@/integrations/telegramLink';

const enabled = Boolean(process.env.DATABASE_URL_TEST);
const SECRET = 'itest-tg-secret';
const MEERA = '00000000-0000-0000-0000-0000000000d4';

describe.skipIf(!enabled)('Telegram connect flow', () => {
  let db: Db;
  let POST: (req: Request) => Promise<Response>;
  const replies: { chat_id: string; text: string }[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.USE_TEST_DB = '1';
    process.env.TELEGRAM_BOT_TOKEN = 'itest';
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    db = createPool(process.env.DATABASE_URL_TEST!);
    await db.query(`update designers set telegram_chat_id = null where id = $1`, [MEERA]);
    await db.query(`update config set value = 'null' where key = 'telegram_team_chat_id'`);
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      replies.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true, result: { message_id: replies.length } });
    }) as typeof fetch;
    ({ POST } = await import('../../app/api/telegram/webhook/route'));
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    await db.query(`update config set value = 'null' where key = 'telegram_team_chat_id'`);
    await db?.end();
  });

  const send = (message: unknown, secret = SECRET) =>
    POST(new Request('https://x.test', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify({ message }) }));

  it('rejects calls without the secret', async () => {
    expect((await send({ chat: { id: 1, type: 'private' }, text: '/start' }, 'wrong')).status).toBe(401);
  });

  it('a designer’s personal link connects their chat', async () => {
    await send({ chat: { id: 777001, type: 'private' }, text: `/start ${designerLinkCode(MEERA, SECRET)}` });
    expect((await db.query(`select telegram_chat_id from designers where id = $1`, [MEERA])).rows[0].telegram_chat_id).toBe('777001');
    expect(replies.at(-1)!.text).toMatch(/^Hi Meera! You're connected/);
  });

  it('a forged link connects nobody', async () => {
    await send({ chat: { id: 666, type: 'private' }, text: `/start ${designerLinkCode(MEERA, 'guess')}` });
    expect((await db.query(`select telegram_chat_id from designers where id = $1`, [MEERA])).rows[0].telegram_chat_id).toBe('777001');
    expect(replies.at(-1)!.text).toMatch(/isn’t valid/);
  });

  it('the /team code connects the group (with or without @botname)', async () => {
    await send({ chat: { id: -100555, type: 'supergroup', title: 'Aangan team' }, text: `/team@AanganBot ${teamLinkCode(SECRET)}` });
    expect((await db.query(`select value from config where key = 'telegram_team_chat_id'`)).rows[0].value).toBe('-100555');
    expect(replies.at(-1)!.text).toMatch(/This group will now get/);
  });

  it('a wrong /team code is refused', async () => {
    await send({ chat: { id: -100999, type: 'group' }, text: '/team team_wrongwrongxx' });
    expect((await db.query(`select value from config where key = 'telegram_team_chat_id'`)).rows[0].value).toBe('-100555');
  });
});
