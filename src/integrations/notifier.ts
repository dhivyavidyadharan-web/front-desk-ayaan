// Telegram alerts to designers. Each message is recorded in `handoffs` first (unique per
// booking/call, kind and chat), so a retried webhook never posts twice.
import type { Extraction } from '../core/extraction';
import type { Db } from '../db/client';
import { FLAG_LABELS, label } from '../crm/labels';
import { bookingMessage, cancelledMessage, qualifiedMessage, type LeadSnapshot } from './messages';
import { TelegramClient, telegramConfigFromEnv, type TelegramApi } from './telegram';

export interface Notifier {
  /** A qualified lead was assigned to a designer (and no booking was made on the call). */
  leadQualified(callId: string): Promise<void>;
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

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly db: Db,
    private readonly api: TelegramApi,
    private readonly cfg: { baseUrl: string },
  ) {}

  private async snapshot(enquiryId: string): Promise<LeadSnapshot> {
    const r = (
      await this.db.query<{ name: string | null; phone: string; parsed: Extraction | null; flags: string[] | null; call_id: string | null }>(
        `select p.name, p.phone,
                (select ex.parsed from public.calls c join public.extractions ex on ex.call_id = c.id and ex.valid
                  where c.enquiry_id = e.id order by c.started_at desc, ex.attempt desc limit 1) as parsed,
                (select c.flags from public.calls c where c.enquiry_id = e.id order by c.started_at desc limit 1) as flags,
                (select c.id from public.calls c where c.enquiry_id = e.id and jsonb_array_length(coalesce(c.transcript, '[]'::jsonb)) > 0
                  order by c.started_at desc limit 1) as call_id
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
      decides: x?.decision_maker.note ?? (x?.decision_maker.is_caller ? 'The client' : null),
      wants: x?.expectations_verbatim ?? null,
      note: x?.handoff_note ?? null,
      flags: (r.flags ?? []).map((f) => label(FLAG_LABELS, f)),
      transcriptUrl: r.call_id ? `${this.cfg.baseUrl}/transcripts/${r.call_id}` : null,
      leadUrl: `${this.cfg.baseUrl}/leads/${enquiryId}`,
    };
  }

  /** Records the message, sends it, then stores the Telegram id. Skips if already sent. */
  private async once(
    ref: { callId?: string; bookingId?: string },
    kind: string,
    designer: { id: string; chatId: string },
    send: (handoffId: string) => Promise<{ messageId: string }>,
  ) {
    const ins = await this.db.query<{ id: string }>(
      `insert into public.handoffs (call_id, booking_id, kind, recipient, designer_id, telegram_chat_id)
       values ($1, $2, $3, 'designer', $4, $5) on conflict do nothing returning id`,
      [ref.callId ?? null, ref.bookingId ?? null, kind, designer.id, designer.chatId],
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

  async leadQualified(callId: string) {
    const c = (
      await this.db.query<{ enquiry_id: string | null; outcome: string | null; designer_id: string | null; chat: string | null }>(
        `select c.enquiry_id, c.outcome, d.id as designer_id, d.telegram_chat_id as chat
           from public.calls c join public.enquiries e on e.id = c.enquiry_id
           left join public.designers d on d.id = e.assigned_designer_id
          where c.id = $1`,
        [callId],
      )
    ).rows[0];
    if (!c?.enquiry_id || c.outcome !== 'qualified' || !c.designer_id || !c.chat) return;
    const text = qualifiedMessage(await this.snapshot(c.enquiry_id));
    await this.once({ callId }, 'qualified_lead', { id: c.designer_id, chatId: c.chat }, () => this.api.send(c.chat!, text));
  }

  private async booking(bookingId: string) {
    return (
      await this.db.query<{ enquiry_id: string; start_at: Date; location_type: 'online' | 'studio' | null; designer_id: string | null; chat: string | null }>(
        `select b.enquiry_id, b.start_at, b.location_type, b.designer_id, d.telegram_chat_id as chat
           from public.bookings b left join public.designers d on d.id = b.designer_id where b.id = $1 and b.enquiry_id is not null`,
        [bookingId],
      )
    ).rows[0];
  }

  async bookingLinked(bookingId: string) {
    const b = await this.booking(bookingId);
    if (!b?.designer_id || !b.chat) return;
    const text = bookingMessage(await this.snapshot(b.enquiry_id), { start: b.start_at, locationType: b.location_type });
    await this.once({ bookingId }, 'booking', { id: b.designer_id, chatId: b.chat }, (handoffId) =>
      this.api.send(b.chat!, text, [{ text: '✓ Acknowledge', data: `ack:${handoffId}` }]),
    );
  }

  async bookingCancelled(bookingId: string) {
    const b = await this.booking(bookingId);
    if (!b?.designer_id || !b.chat) return;
    const text = cancelledMessage(await this.snapshot(b.enquiry_id), b.start_at);
    await this.once({ bookingId }, 'booking_cancelled', { id: b.designer_id, chatId: b.chat }, () => this.api.send(b.chat!, text));
  }
}
