// Runs once a day (Vercel cron; the Hobby plan allows daily schedules).
//   1. Consultation done, no update for N days → follow-up reminder for the lead's designer.
//   2. Retention: after `retention_days`, delete transcripts, recordings and free-text personal
//      details from extractions. Outcomes, flags, costs and area/scope stay for the metrics.
import { opsConfigFromRows } from '../core/config';
import { withTransaction, type Db } from '../db/client';

export async function runDailyJobs(db: Db, now = new Date()) {
  return withTransaction(db, async (tx) => {
    const { rows: cfg } = await tx.query<{ key: string; value: unknown }>('select key, value from public.config');
    const ops = opsConfigFromRows(cfg);
    const followupDays = Number(cfg.find((r) => r.key === 'consultation_followup_days')?.value ?? 3);

    const followUps = await tx.query(
      `insert into public.tasks (type, enquiry_id, title, due_at, assigned_to)
       select 'follow_up', e.id, 'Follow up after consultation: no update for ' || $2 || ' days', $1,
              (select s.id from public.staff s where s.designer_id = e.assigned_designer_id and s.active limit 1)
         from public.enquiries e
        where e.stage = 'consultation_done'
          and e.stage_changed_at < $1::timestamptz - make_interval(days => $2::int)
          and e.last_activity_at < $1::timestamptz - make_interval(days => $2::int)
          and not exists (select 1 from public.tasks t where t.enquiry_id = e.id and t.type = 'follow_up'
                           and t.status in ('open','in_progress'))
       returning id`,
      [now, followupDays],
    );

    const redacted = await tx.query<{ id: string }>(
      `update public.calls set transcript = null, recording_url = null, redacted_at = $1
        where redacted_at is null and started_at < $1::timestamptz - make_interval(days => $2::int)
        returning id`,
      [now, ops.retentionDays],
    );
    if (redacted.rows.length) {
      await tx.query(
        `update public.extractions set raw_output = null,
           parsed = parsed - 'caller' - 'expectations_verbatim' - 'handoff_note' - 'complaint' - 'decision_maker'
         where call_id = any($1::uuid[])`,
        [redacted.rows.map((r) => r.id)],
      );
    }

    return { followUpsCreated: followUps.rowCount ?? 0, callsRedacted: redacted.rows.length, retentionDays: ops.retentionDays };
  });
}
