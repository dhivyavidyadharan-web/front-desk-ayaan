// Minimal Telegram Bot API client.
const API = 'https://api.telegram.org';

export interface TelegramConfig {
  botToken: string;
  /** Sent back by Telegram on every webhook call; also the key for signing connect links. */
  webhookSecret: string;
}

export function telegramConfigFromEnv(env = process.env): TelegramConfig | null {
  const { TELEGRAM_BOT_TOKEN: botToken, TELEGRAM_WEBHOOK_SECRET: webhookSecret } = env;
  return botToken && webhookSecret ? { botToken, webhookSecret } : null;
}

export interface TelegramApi {
  send(chatId: string, html: string, buttons?: { text: string; data: string }[]): Promise<{ messageId: string }>;
  answerCallback(callbackId: string, text: string): Promise<void>;
  /** Removes the inline buttons (e.g. after Acknowledge was pressed). */
  clearButtons(chatId: string, messageId: string): Promise<void>;
}

export class TelegramClient implements TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T>(method: string, body: unknown = {}): Promise<T> {
    const res = await this.fetchImpl(`${API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
    return json.result as T;
  }

  async send(chatId: string, html: string, buttons?: { text: string; data: string }[]) {
    const r = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(buttons?.length ? { reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] } } : {}),
    });
    return { messageId: String(r.message_id) };
  }

  async answerCallback(callbackId: string, text: string) {
    await this.call('answerCallbackQuery', { callback_query_id: callbackId, text });
  }

  async clearButtons(chatId: string, messageId: string) {
    await this.call('editMessageReplyMarkup', { chat_id: chatId, message_id: Number(messageId), reply_markup: { inline_keyboard: [] } });
  }
}

let botUsername: string | null = null;
/** The bot's @username, for t.me links. Cached per server instance. */
export async function getBotUsername(cfg: TelegramConfig): Promise<string | null> {
  if (botUsername) return botUsername;
  try {
    botUsername = (await new TelegramClient(cfg.botToken).call<{ username: string }>('getMe')).username;
  } catch {
    return null;
  }
  return botUsername;
}
