// Minimal Telegram Bot API client.
const API = 'https://api.telegram.org';

export interface TelegramConfig {
  botToken: string;
  teamChatId: string;
  webhookSecret: string;
}

export function telegramConfigFromEnv(env = process.env): TelegramConfig | null {
  const { TELEGRAM_BOT_TOKEN: botToken, TELEGRAM_TEAM_CHAT_ID: teamChatId, TELEGRAM_WEBHOOK_SECRET: webhookSecret } = env;
  return botToken && teamChatId && webhookSecret ? { botToken, teamChatId, webhookSecret } : null;
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

  private async call<T>(method: string, body: unknown): Promise<T> {
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
