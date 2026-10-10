// Points the Telegram bot at the live app and sets its commands. Prints no secrets.
// Usage: npm run telegram:setup   (after the app is deployed)
import { TelegramClient, telegramConfigFromEnv } from '../src/integrations/telegram';
import { appBaseUrl } from '../src/integrations/notifier';

const cfg = telegramConfigFromEnv();
if (!cfg) {
  console.error('Save TELEGRAM_BOT_TOKEN first: node scripts/set-secret.mjs TELEGRAM_BOT_TOKEN');
  process.exit(1);
}
const base = process.env.TELEGRAM_WEBHOOK_BASE ?? appBaseUrl({ ...process.env, APP_BASE_URL: 'https://front-desk-ayaan.vercel.app' });
const api = new TelegramClient(cfg.botToken);
const me = await api.call<{ username: string }>('getMe');
await api.call('setWebhook', {
  url: `${base}/api/telegram/webhook`,
  secret_token: cfg.webhookSecret,
  allowed_updates: ['message', 'callback_query'], // /start links and the Acknowledge button
  drop_pending_updates: true,
});
await api.call('setMyCommands', { commands: [{ command: 'start', description: 'Connect with your personal link' }] });
const info = await api.call<{ url: string; pending_update_count: number; last_error_message?: string }>('getWebhookInfo');
console.log(`✓ Bot @${me.username} now sends updates to ${info.url}`);
if (info.last_error_message) console.log(`  Last error from Telegram: ${info.last_error_message}`);
