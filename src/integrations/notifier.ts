// Sends Telegram messages for calls and bookings. Each message is recorded in `handoffs` first
// (unique per booking/call, kind and chat), so a retried webhook never posts twice.
import type { Extraction } from '../core/extraction';
import type { Db } from '../db/client';
import { FLAG_LABELS, DECLINE_LABELS, label } from '../crm/labels';
import { bookingMessage, callSummaryMessage, cancelledMessage, type LeadFacts } from './messages';
import { TelegramClient, telegramConfigFromEnv, type TelegramApi } from './telegram';

export interface Notifier {
  callProcessed(callId: string): Promise<void>;
  bookingLinked(bookingId: string): Promise<void>;
  bookingCancelled(bookingId: string): Promise<void>;
}

export function appBaseUrl(env = process.env): string {
  if (env.APP_BASE_URL && !env.APP_BASE_URL.includes('localhost')) return env.APP_BASE_URL.replace(/\/$/, '');
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return env.APP_BASE_URL ?? 'http://localhost:3000';
}

export function notifierFromEnv(db: Db): Notifier | undefined {
  const cfg = telegramConfigFromEnv();
  return cfg ? new TelegramNotifier(db, new TelegramClient(cfg.botToken), { baseUrl: appBaseUrl() }) : undefined;
}

/** The connected team group (set via "/team <code>"), else TELEGRAM_TEAM_CHAT_ID, else none. */
export async function teamChatId(db: Db): Promise<string | null> {
  const r = await db.query<{ value: unknown }>(`select value from public.config where key = 'telegram_team_chat_id'`);
  const v = r.rows[0]?.value;
  return typeof v === 'string' || typeof v === 'number' ? String(v) : (process.env.TELEGRAM_TEAM_CHAT_ID ?? null);
}

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly db: Db,
    private readonly api: TelegramApi,
    private readonly cfg: { baseUrl: string; teamChatId?: string },
  ) {}

  private async team(): Promise<string | null> {
    return this.cfg.teamChatId ?? (await teamChatId(this.db));
  }

  private async facts(enquiryId: string): Promise<LeadFacts> {
    const r = (
      await this.db.query<{ name: string | null; phone: string; parsed: Extraction | null; flags: string[] | null }>(
        `select p.name, p.phone,
                (select ex.parsed from public.calls c join public.extractions ex on ex.call_id = c.id and ex.valid
                  where c.enquiry_id = e.id order by c.started_at desc, ex.attempt desc limit 1) as parsed,
                (select c.flags from public.calls c where c.enquiry_id = e.id order by c.started_at desc limit 1) as flags
           from public.enquiries e join public.callers p on p.id = e.caller_id where e.id = $1`,
        [enquiryId],
      )
    ).rows[0]!;
    const x = r.parsed;
    return {
      name: r.name ?? x?.caller.name ?? null,
      phone: r.phone,
      area: x?.project.area_locality ?? null,
      scope: x?.project.scope_summary ?? null,
      sizeSqft: x?.project.size_sqft ?? null,
      timeline: x?.timeline.stated ?? null,
      expectations: x?.expectations_verbatim ?? null,
      handoffNote: x?.handoff_note ?? null,
      flags: (r.flags ?? []).map((f) => label(FLAG_LABELS, f)),
      leadUrl: `${this.cfg.baseUrl}/leads/${enquiryId}`,
    };
  }

  /** Records the message, sends it, then stores the Telegram id. Skips if already sent. */
  private async once(
    ref: { callId?: string; bookingId?: string },
    kind: string,
    chatId: string,
    recipient: { type: 'team' } | { type: 'designer'; designerId: string },
    send: (handoffId: string) => Promise<{ messageId: string }>,
  ) {
    const ins = await this.db.query<{ id: string }>(
      `insert into public.handoffs (call_id, booking_id, kind, recipient, designer_id, telegram_chat_id)
       values ($1, $2, $3, $4::public.handoff_recipient, $5, $6) on conflict do nothing returning id`,
      [ref.callId ?? null, ref.bookingId ?? null, kind, recipient.type, recipient.type === 'designer' ? recipient.designerId : null, chatId],
    );
    const id = ins.rows[0]?.id;
    if (!id) return;
    try {
      const { messageId } = await send(id);
      await this.db.query(`update public.handoffs set telegram_message_id = $2, sent_at = now() where id = $1`, [id, messageId]);
    } catch (err) {
      await this.db.query(`delete from public.handoffs where id = $1`, [id]);
      await this.db.query(`insert into public.alerts (type, call_id, details) values ('integration_failed', $1, $2)`, [
        ref.callId ?? null,
        JSON.stringify({ service: 'telegram', kind, bookingId: ref.bookingId ?? null, error: (err as Error).message }),
      ]);
    }
  }

  async callProcessed(callId: string) {
    const c = (
      await this.db.query<{ enquiry_id: string | null; outcome: string | null; decline_reason: string | null; open_question: string | null; outside_hours: boolean | null; complaint: string | null }>(
        `select c.enquiry_id, c.outcome, c.decline_reason, c.open_question, c.outside_hours,
                (select ex.parsed->'complaint'->>'summary' from public.extractions ex where ex.call_id = c.id and ex.valid order by ex.attempt desc limit 1) as complaint
           from public.calls c where c.id = $1`,
        [callId],
      )
    ).rows[0];
    if (!c?.enquiry_id) return;
    const facts = await this.facts(c.enquiry_id);
    const text = callSummaryMessage(facts, {
      outcome: c.outcome,
      declineReason: c.decline_reason ? label(DECLINE_LABELS, c.decline_reason) : null,
      openQuestion: c.open_question,
      complaint: c.complaint,
      afterHours: Boolean(c.outside_hours),
    });
    const team = await this.team();
    if (team) await this.once({ callId }, 'call_summary', team, { type: 'team' }, () => this.api.send(team, text));
  }

  private async booking(bookingId: string) {
    return (
      await this.db.query<{ enquiry_id: string; start_at: Date; location_type: 'online' | 'studio' | null; designer_id: string | null; designer_name: string | null; designer_chat: string | null }>(
        `select b.enquiry_id, b.start_at, b.location_type, b.designer_id, d.name as designer_name, d.telegram_chat_id as designer_chat
           from public.bookings b left join public.designers d on d.id = b.designer_id where b.id = $1 and b.enquiry_id is not null`,
        [bookingId],
      )
    ).rows[0];
  }

  async bookingLinked(bookingId: string) {
    const b = await this.booking(bookingId);
    if (!b) return;
    const text = bookingMessage(await this.facts(b.enquiry_id), { start: b.start_at, locationType: b.location_type, designerName: b.designer_name });
    const team = await this.team();
    if (team) await this.once({ bookingId }, 'booking', team, { type: 'team' }, () => this.api.send(team, text));
    if (b.designer_id && b.designer_chat) {
      await this.once({ bookingId }, 'booking', b.designer_chat, { type: 'designer', designerId: b.designer_id }, (handoffId) =>
        this.api.send(b.designer_chat!, text, [{ text: '✓ Acknowledge', data: `ack:${handoffId}` }]),
      );
    }
  }

  async bookingCancelled(bookingId: string) {
    const b = await this.booking(bookingId);
    if (!b) return;
    const text = cancelledMessage(await this.facts(b.enquiry_id), b.start_at);
    const team = await this.team();
    if (team) await this.once({ bookingId }, 'booking_cancelled', team, { type: 'team' }, () => this.api.send(team, text));
    if (b.designer_id && b.designer_chat) {
      await this.once({ bookingId }, 'booking_cancelled', b.designer_chat, { type: 'designer', designerId: b.designer_id }, () =>
        this.api.send(b.designer_chat!, text),
      );
    }
  }
}
