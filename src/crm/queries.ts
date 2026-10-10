// Dashboard reads. Every function takes a transaction opened with withDashboardUser, so RLS
// decides what the signed-in person can see.
import { ACTIVE_STAGES, type LeadStage } from '../core/crm';
import type { Extraction } from '../core/extraction';
import { getPool, type Tx } from '../db/client';

/** Non-sensitive settings the dashboard needs for every role (read with the owner connection). */
export async function dashboardSettings() {
  const { rows } = await getPool().query<{ key: string; value: unknown }>(
    `select key, value from public.config where key in ('stale_lead_days', 'avg_project_value_inr')`,
  );
  const get = (k: string, d: number) => Number(rows.find((r) => r.key === k)?.value ?? d);
  return { staleLeadDays: get('stale_lead_days', 7), avgProjectValueInr: get('avg_project_value_inr', 1_100_000) };
}

/** Latest valid extraction for an enquiry, as a lateral join. */
const LATEST_EXTRACTION = `
  left join lateral (
    select ex.parsed from public.calls c2
      join public.extractions ex on ex.call_id = c2.id and ex.valid
     where c2.enquiry_id = e.id
     order by c2.started_at desc, ex.attempt desc limit 1
  ) x on true`;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type Period = '7' | '30' | '90' | 'all';
export const periodDays = (p: Period) => (p === 'all' ? null : Number(p));

export async function overview(tx: Tx, period: Period) {
  const days = periodDays(period);
  const since = `($1::int is null or %col >= now() - make_interval(days => $1::int))`;
  const callsIn = since.replace('%col', 'c.started_at');
  const enqIn = since.replace('%col', 'e.opened_at');

  const calls = (
    await tx.query<{ calls: number; after_hours: number; answered: number; asked_price: number; price_leaks: number }>(
      `select count(*)::int as calls,
              count(*) filter (where c.outside_hours)::int as after_hours,
              count(*) filter (where c.answered_at is not null)::int as answered,
              count(*) filter (where 'asked_about_price' = any(c.flags))::int as asked_price,
              count(*) filter (where c.price_leak_flag)::int as price_leaks
         from public.calls c where ${callsIn}`,
      [days],
    )
  ).rows[0]!;

  const outcomes = (
    await tx.query<{ outcome: string; n: number }>(
      `select e.outcome::text as outcome, count(*)::int as n from public.enquiries e
        where e.outcome is not null and ${enqIn} group by 1`,
      [days],
    )
  ).rows;

  const declineReasons = (
    await tx.query<{ reason: string; n: number }>(
      `select coalesce(e.decline_reason, 'unknown') as reason, count(*)::int as n from public.enquiries e
        where e.outcome = 'declined' and ${enqIn} group by 1 order by 2 desc`,
      [days],
    )
  ).rows;

  const funnel = (
    await tx.query<{ enquiries: number; qualified: number; booked: number; won: number }>(
      `select count(*) filter (where e.stage is not null)::int as enquiries,
              count(*) filter (where e.stage in ('qualified','consultation_booked','consultation_done','proposal_sent','won')
                                  or (e.stage = 'lost' and e.outcome = 'qualified'))::int as qualified,
              count(*) filter (where e.stage in ('consultation_booked','consultation_done','proposal_sent','won'))::int as booked,
              count(*) filter (where e.stage = 'won')::int as won
         from public.enquiries e where ${enqIn}`,
      [days],
    )
  ).rows[0]!;

  const pipeline = (
    await tx.query<{ active: number }>(
      `select count(*)::int as active from public.enquiries e where e.stage = any($1::public.lead_stage[])`,
      [ACTIVE_STAGES],
    )
  ).rows[0]!;

  const cost = (
    await tx.query<{ total: string | null; calls: number }>(
      `select sum(k.total_cost_inr) as total, count(*)::int as calls
         from public.costs k join public.calls c on c.id = k.call_id where ${callsIn}`,
      [days],
    )
  ).rows[0]!;

  const handoff = (
    await tx.query<{ to_sent: string | null; to_ack: string | null; n: number }>(
      `select avg(extract(epoch from (h.sent_at - c.ended_at)) / 60) as to_sent,
              avg(extract(epoch from (h.acknowledged_at - c.ended_at)) / 60) as to_ack,
              count(*)::int as n
         from public.handoffs h join public.calls c on c.id = h.call_id
        where h.recipient = 'designer' and h.sent_at is not null and ${callsIn}`,
      [days],
    )
  ).rows[0]!;

  const top = async (expr: string) =>
    (
      await tx.query<{ value: string; n: number }>(
        `select ${expr} as value, count(*)::int as n from public.enquiries e ${LATEST_EXTRACTION}
          where ${enqIn} and ${expr} is not null and e.stage is not null group by 1 order by 2 desc, 1 limit 6`,
        [days],
      )
    ).rows;

  const tasks = (
    await tx.query<{ open: number; overdue: number }>(
      `select count(*) filter (where status in ('open','in_progress'))::int as open,
              count(*) filter (where status in ('open','in_progress') and due_at < now())::int as overdue
         from public.tasks`,
    )
  ).rows[0]!;

  return {
    calls,
    outcomes: Object.fromEntries(outcomes.map((o) => [o.outcome, o.n])) as Record<string, number>,
    declineReasons,
    funnel,
    activeLeads: pipeline.active,
    cost: { total: Number(cost.total ?? 0), calls: cost.calls },
    handoff: { toSentMin: handoff.to_sent ? Number(handoff.to_sent) : null, toAckMin: handoff.to_ack ? Number(handoff.to_ack) : null, n: handoff.n },
    topAreas: await top(`x.parsed->'project'->>'area_locality'`),
    topReferrals: await top(`x.parsed->>'referral_source'`),
    topTypes: await top(`x.parsed->'project'->>'type'`),
    tasks,
  };
}

// ---------------------------------------------------------------------------
// Pipeline board
// ---------------------------------------------------------------------------

export interface BoardCard {
  id: string;
  stage: LeadStage;
  score: 'hot' | 'warm' | 'cold' | null;
  scoreReasons: string[];
  name: string | null;
  phone: string;
  area: string | null;
  scope: string | null;
  sizeSqft: number | null;
  designerName: string | null;
  lostReason: string | null;
  lastActivityAt: string;
  openTasks: number;
  openComplaint: boolean;
}

export async function board(tx: Tx, filters: { designerId: string | null; score: string | null }): Promise<BoardCard[]> {
  const { rows } = await tx.query(
    `select e.id, e.stage, e.score, e.score_reasons, e.lost_reason, e.last_activity_at,
            p.name, p.phone, d.name as designer_name,
            x.parsed->'project'->>'area_locality' as area,
            x.parsed->'project'->>'scope_summary' as scope,
            (x.parsed->'project'->>'size_sqft')::numeric as size_sqft,
            (select count(*) from public.tasks t where t.enquiry_id = e.id and t.status in ('open','in_progress'))::int as open_tasks,
            exists (select 1 from public.tasks t join public.enquiries e2 on e2.id = t.enquiry_id
                     where e2.caller_id = e.caller_id and t.type = 'complaint' and t.status in ('open','in_progress')) as open_complaint
       from public.enquiries e
       join public.callers p on p.id = e.caller_id
       left join public.designers d on d.id = e.assigned_designer_id
       ${LATEST_EXTRACTION}
      where e.stage is not null
        and ($1::uuid is null or e.assigned_designer_id = $1)
        and ($2::text is null or e.score::text = $2)
      order by case e.score when 'hot' then 0 when 'warm' then 1 when 'cold' then 2 else 3 end, e.last_activity_at desc`,
    [filters.designerId, filters.score],
  );
  return rows.map((r) => ({
    id: r.id,
    stage: r.stage,
    score: r.score,
    scoreReasons: r.score_reasons,
    name: r.name,
    phone: r.phone,
    area: r.area,
    scope: r.scope,
    sizeSqft: r.size_sqft === null ? null : Number(r.size_sqft),
    designerName: r.designer_name,
    lostReason: r.lost_reason,
    lastActivityAt: new Date(r.last_activity_at).toISOString(),
    openTasks: r.open_tasks,
    openComplaint: r.open_complaint,
  }));
}

export async function designers(tx: Tx) {
  return (await tx.query<{ id: string; name: string }>(`select id, name from public.designers where active order by name`)).rows;
}

export async function staffMembers(tx: Tx) {
  return (
    await tx.query<{ id: string; display_name: string | null; email: string; role: string }>(
      `select id, display_name, email, role from public.staff where active order by role, display_name`,
    )
  ).rows;
}

// ---------------------------------------------------------------------------
// Lead detail
// ---------------------------------------------------------------------------

export async function lead(tx: Tx, id: string) {
  const head = (
    await tx.query(
      `select e.*, p.name, p.phone, p.email, p.referral_source, d.name as designer_name
         from public.enquiries e join public.callers p on p.id = e.caller_id
         left join public.designers d on d.id = e.assigned_designer_id
        where e.id = $1`,
      [id],
    )
  ).rows[0];
  if (!head) return null;

  const calls = (
    await tx.query(
      `select c.id, c.started_at, c.duration_seconds, c.outcome, c.decline_reason, c.flags, c.open_question,
              c.transcript, c.recording_url, c.price_leak_flag, c.outside_hours, c.criteria, c.status, c.redacted_at,
              (select ex.parsed from public.extractions ex where ex.call_id = c.id and ex.valid order by ex.attempt desc limit 1) as extraction
         from public.calls c where c.enquiry_id = $1 order by c.started_at desc`,
      [id],
    )
  ).rows as {
    id: string;
    started_at: Date;
    duration_seconds: number | null;
    outcome: string | null;
    decline_reason: string | null;
    flags: string[];
    open_question: string | null;
    transcript: { speaker: 'agent' | 'caller'; text: string }[] | null;
    recording_url: string | null;
    price_leak_flag: boolean;
    outside_hours: boolean | null;
    criteria: Record<string, string> | null;
    status: string;
    redacted_at: Date | null;
    extraction: Extraction | null;
  }[];

  const activities = (
    await tx.query<{ id: string; kind: string; body: string; author_name: string; created_at: Date }>(
      `select id, kind, body, author_name, created_at from public.activities
        where enquiry_id = $1 order by created_at desc, seq desc`,
      [id],
    )
  ).rows;

  const tasks = (
    await tx.query<{
      id: string;
      type: string;
      status: string;
      title: string | null;
      question: string | null;
      due_at: Date | null;
      assignee: string | null;
    }>(
      `select t.id, t.type, t.status, t.title, t.question, t.due_at, s.display_name as assignee
         from public.tasks t left join public.staff s on s.id = t.assigned_to
        where t.enquiry_id = $1 and t.status in ('open','in_progress') order by t.due_at nulls last`,
      [id],
    )
  ).rows;

  const bookings = (
    await tx.query<{ id: string; start_at: Date; location_type: string | null; meeting_url: string | null; status: string; designer: string | null }>(
      `select b.id, b.start_at, b.location_type, b.meeting_url, b.status, d.name as designer
         from public.bookings b left join public.designers d on d.id = b.designer_id
        where b.enquiry_id = $1 order by b.start_at desc`,
      [id],
    )
  ).rows;

  const latest = calls.find((c) => c.extraction)?.extraction ?? null;
  return { head, calls, activities, tasks, latest, bookings };
}

// ---------------------------------------------------------------------------
// Calls list
// ---------------------------------------------------------------------------

export interface CallFilters {
  outcome: string | null;
  q: string | null;
  period: Period;
  leaksOnly: boolean;
  limit: number;
}

export async function callsList(tx: Tx, f: CallFilters) {
  const { rows } = await tx.query(
    `select c.id, c.started_at, c.duration_seconds, c.outcome, c.decline_reason, c.flags, c.price_leak_flag,
            c.outside_hours, c.status, c.enquiry_id, p.name, p.phone,
            x.parsed->'project'->>'area_locality' as area, x.parsed->'project'->>'scope_summary' as scope
       from public.calls c
       left join public.callers p on p.id = c.caller_id
       left join lateral (select ex.parsed from public.extractions ex where ex.call_id = c.id and ex.valid
                           order by ex.attempt desc limit 1) x on true
      where ($1::text is null or c.outcome::text = $1)
        and ($2::text is null or p.name ilike $2 or p.phone like $2 or x.parsed->'project'->>'area_locality' ilike $2)
        and ($3::int is null or c.started_at >= now() - make_interval(days => $3::int))
        and (not $4::boolean or c.price_leak_flag)
      order by c.started_at desc
      limit $5`,
    [f.outcome, f.q ? `%${f.q}%` : null, periodDays(f.period), f.leaksOnly, f.limit + 1],
  );
  return { rows: rows.slice(0, f.limit), hasMore: rows.length > f.limit };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskView = 'open' | 'mine' | 'done';

export async function tasksList(tx: Tx, view: TaskView, staffId: string) {
  const { rows } = await tx.query<{
    id: string;
    type: string;
    status: string;
    title: string | null;
    question: string | null;
    due_at: Date | null;
    resolved_at: Date | null;
    enquiry_id: string | null;
    name: string | null;
    phone: string | null;
    assignee: string | null;
  }>(
    `select t.id, t.type, t.status, t.title, t.question, t.due_at, t.resolved_at, t.enquiry_id,
            p.name, p.phone, s.display_name as assignee
       from public.tasks t
       left join public.enquiries e on e.id = t.enquiry_id
       left join public.callers p on p.id = e.caller_id
       left join public.staff s on s.id = t.assigned_to
      where case $1
              when 'done' then t.status in ('done','cancelled')
              when 'mine' then t.status in ('open','in_progress') and t.assigned_to = $2
              else t.status in ('open','in_progress')
            end
      order by case when $1 = 'done' then null else t.due_at end nulls last, t.resolved_at desc nulls last
      limit 200`,
    [view, staffId],
  );
  return rows;
}

export async function openTaskCount(tx: Tx) {
  return (
    await tx.query<{ n: number }>(`select count(*)::int as n from public.tasks where status in ('open','in_progress')`)
  ).rows[0]!.n;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function configRows(tx: Tx) {
  return (
    await tx.query<{ key: string; value: unknown; confirmed: boolean; description: string; updated_at: Date }>(
      `select key, value, confirmed, description, updated_at from public.config order by key`,
    )
  ).rows;
}
