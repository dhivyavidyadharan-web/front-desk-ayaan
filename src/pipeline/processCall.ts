// What happens around a call. Channel-agnostic: it only sees an Interaction.
//   call start → getCallerContext (name for the greeting; resume a dropped enquiry)
//   call end   → handleCallEnded (store, extract, decide, scan, queue, then side-effects)
import type { Interaction } from '../channels/interaction';
import type { VoiceProvider } from '../channels/voice/VoiceProvider';
import {
  configFromRows,
  isOutsideOfficeHours,
  opsConfigFromRows,
  type OpsConfig,
  type RubricConfig,
} from '../core/config';
import { decideOutcome, type Decision, type Outcome } from '../core/decideOutcome';
import { shouldJoinPreviousEnquiry } from '../core/enquiry';
import { scanTranscriptForPriceLeaks } from '../core/priceLeak';
import { withTransaction, type Db, type Tx } from '../db/client';
import type { Extractor } from '../llm/extractor';

export interface CostRates {
  voicePerMinuteInr: number;
  llmInputPerMTokInr: number;
  llmOutputPerMTokInr: number;
}

export interface PipelineDeps {
  db: Db;
  extractor: Extractor;
  voice: VoiceProvider;
  now?: () => Date;
  costRates?: CostRates;
}

export interface CallerContext {
  known: boolean;
  name: string | null;
  nameConfirmed: boolean;
  /** Set when the caller rang back within the dedupe window: the agent continues, not restarts. */
  resuming: { enquiryId: string; summary: string | null } | null;
}

export interface ProcessResult {
  callId: string;
  enquiryId: string;
  outcome: Outcome | null;
  status: 'processed' | 'needs_review';
  flags: string[];
  priceLeak: boolean;
  callbackPlaced: boolean;
  duplicate: boolean;
}

export function costRatesFromEnv(env = process.env): CostRates {
  const num = (v: string | undefined) => (v ? Number(v) : 0);
  return {
    voicePerMinuteInr: num(env.VOICE_COST_PER_MINUTE_INR),
    llmInputPerMTokInr: num(env.GEMINI_INPUT_COST_PER_MTOK_INR),
    llmOutputPerMTokInr: num(env.GEMINI_OUTPUT_COST_PER_MTOK_INR),
  };
}

async function loadConfig(db: Db | Tx): Promise<{ rubric: RubricConfig; ops: OpsConfig }> {
  const { rows } = await db.query<{ key: string; value: unknown }>('select key, value from public.config');
  return { rubric: configFromRows(rows), ops: opsConfigFromRows(rows) };
}

// ---------------------------------------------------------------------------
// Call start
// ---------------------------------------------------------------------------

export async function getCallerContext(deps: PipelineDeps, from: string, at: Date): Promise<CallerContext> {
  const { ops } = await loadConfig(deps.db);
  const caller = await deps.db.query<{ id: string; name: string | null; name_confirmed: boolean }>(
    'select id, name, name_confirmed from public.callers where phone = $1',
    [from],
  );
  const row = caller.rows[0];
  if (!row) return { known: false, name: null, nameConfirmed: false, resuming: null };

  const last = await deps.db.query<{ enquiry_id: string; last_at: Date; summary: string | null }>(
    `select c.enquiry_id, coalesce(c.ended_at, c.started_at) as last_at,
            (select e.parsed->>'handoff_note' from public.extractions e
              where e.call_id = c.id and e.valid order by e.attempt desc limit 1) as summary
       from public.calls c
      where c.caller_id = $1 and c.enquiry_id is not null
      order by coalesce(c.ended_at, c.started_at) desc
      limit 1`,
    [row.id],
  );
  const prev = last.rows[0];
  const resuming =
    prev && shouldJoinPreviousEnquiry(prev.last_at, at, ops.dedupeWindowMinutes)
      ? { enquiryId: prev.enquiry_id, summary: prev.summary }
      : null;
  return { known: true, name: row.name, nameConfirmed: row.name_confirmed, resuming };
}

// ---------------------------------------------------------------------------
// Call end
// ---------------------------------------------------------------------------

export async function handleCallEnded(deps: PipelineDeps, interaction: Interaction): Promise<ProcessResult> {
  const now = deps.now?.() ?? new Date();
  const { rubric, ops } = await loadConfig(deps.db);

  const existing = await deps.db.query<{
    id: string;
    enquiry_id: string;
    outcome: Outcome | null;
    status: string;
    flags: string[];
    price_leak_flag: boolean;
  }>(
    `select id, enquiry_id, outcome, status, flags, price_leak_flag from public.calls
      where provider = $1 and provider_call_id = $2`,
    [interaction.provider, interaction.providerCallId],
  );
  const done = existing.rows[0];
  if (done && done.status !== 'in_progress') {
    return {
      callId: done.id,
      enquiryId: done.enquiry_id,
      outcome: done.outcome,
      status: done.status === 'processed' ? 'processed' : 'needs_review',
      flags: done.flags,
      priceLeak: done.price_leak_flag,
      callbackPlaced: false,
      duplicate: true,
    };
  }

  const answered = interaction.answeredAt !== null;
  // Network work happens before the transaction.
  const extracted = answered ? await deps.extractor.extract(interaction) : { extraction: null, attempts: [] };
  const extraction = extracted.extraction;
  const decision: Decision | null =
    !answered || extraction ? decideOutcome({ answered, startedAt: interaction.startedAt }, extraction, rubric) : null;
  const leaks = scanTranscriptForPriceLeaks(interaction.turns);
  const status = decision ? 'processed' : 'needs_review';

  const stored = await withTransaction(deps.db, async (tx) => {
    const caller = await tx.query<{ id: string }>(
      `insert into public.callers (phone) values ($1)
       on conflict (phone) do update set updated_at = now()
       returning id`,
      [interaction.from],
    );
    const callerId = caller.rows[0]!.id;

    // Same enquiry if the caller's previous call ended within the dedupe window (T17).
    const prev = await tx.query<{ enquiry_id: string; last_at: Date }>(
      `select enquiry_id, coalesce(ended_at, started_at) as last_at from public.calls
        where caller_id = $1 and enquiry_id is not null and provider_call_id <> $2
        order by coalesce(ended_at, started_at) desc limit 1`,
      [callerId, interaction.providerCallId],
    );
    const join = prev.rows[0] && shouldJoinPreviousEnquiry(prev.rows[0].last_at, interaction.startedAt, ops.dedupeWindowMinutes);
    const lastActivity = interaction.endedAt ?? interaction.startedAt;
    const enquiryId = join
      ? prev.rows[0]!.enquiry_id
      : (
          await tx.query<{ id: string }>(
            `insert into public.enquiries (caller_id, opened_at, last_activity_at) values ($1, $2, $3) returning id`,
            [callerId, interaction.startedAt, lastActivity],
          )
        ).rows[0]!.id;

    const call = await tx.query<{ id: string }>(
      `insert into public.calls (
         enquiry_id, caller_id, provider, provider_call_id, direction, from_number, started_at, answered_at,
         ended_at, duration_seconds, outside_hours, status, outcome, decline_reason, flags, open_question,
         transcript, recording_url, language, price_leak_flag, prompt_version)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       on conflict (provider, provider_call_id) do update set
         enquiry_id = excluded.enquiry_id, caller_id = excluded.caller_id, answered_at = excluded.answered_at,
         ended_at = excluded.ended_at, duration_seconds = excluded.duration_seconds,
         outside_hours = excluded.outside_hours, status = excluded.status, outcome = excluded.outcome,
         decline_reason = excluded.decline_reason, flags = excluded.flags, open_question = excluded.open_question,
         transcript = excluded.transcript, recording_url = excluded.recording_url, language = excluded.language,
         price_leak_flag = excluded.price_leak_flag, prompt_version = excluded.prompt_version
       returning id`,
      [
        enquiryId,
        callerId,
        interaction.provider,
        interaction.providerCallId,
        interaction.direction,
        interaction.from,
        interaction.startedAt,
        interaction.answeredAt,
        interaction.endedAt,
        interaction.durationSeconds,
        isOutsideOfficeHours(interaction.startedAt, ops.officeHours),
        status,
        decision?.outcome ?? null,
        decision?.declineReason ?? null,
        decision?.flags ?? [],
        decision?.openQuestion ?? null,
        JSON.stringify(interaction.turns),
        interaction.recordingUrl,
        extraction?.language ?? null,
        leaks.length > 0,
        extracted.attempts.at(-1)?.promptVersion ?? null,
      ],
    );
    const callId = call.rows[0]!.id;

    for (const a of extracted.attempts) {
      await tx.query(
        `insert into public.extractions
           (call_id, attempt, model, prompt_version, raw_output, parsed, valid, error, input_tokens, output_tokens)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (call_id, attempt) do nothing`,
        [callId, a.attempt, a.model, a.promptVersion, a.rawOutput, a.parsed && JSON.stringify(a.parsed), a.valid, a.error, a.inputTokens, a.outputTokens],
      );
    }

    if (extraction) {
      await tx.query(
        `update public.callers set
           name = coalesce(name, $2), email = coalesce($3, email), referral_source = coalesce(referral_source, $4)
         where id = $1`,
        [callerId, extraction.caller.name, extraction.caller.email, extraction.referral_source],
      );
    }

    if (decision) {
      // A missed call doesn't overwrite an outcome the enquiry already has.
      await tx.query(
        `update public.enquiries set
           outcome = case when $2::text = 'missed' and outcome is not null then outcome else ($2::text)::public.call_outcome end,
           decline_reason = case when $2::text = 'missed' and outcome is not null then decline_reason else $3 end,
           last_activity_at = greatest(last_activity_at, $4)
         where id = $1`,
        [enquiryId, decision.outcome, decision.declineReason, lastActivity],
      );
    }

    // The caller rang back: stop the bot calling them.
    if (interaction.direction === 'inbound' && answered) {
      await tx.query(
        `update public.tasks set status = 'cancelled', resolved_at = $2,
           notes = concat_ws(' ', notes, 'Caller rang back.')
         where type = 'callback' and status in ('open', 'in_progress')
           and enquiry_id in (select id from public.enquiries where caller_id = $1)`,
        [callerId, now],
      );
    }

    let callbackTaskId: string | null = null;
    if (decision?.outcome === 'missed' && interaction.direction === 'inbound') {
      callbackTaskId = (
        await tx.query<{ id: string }>(
          `insert into public.tasks (type, call_id, enquiry_id, next_attempt_at) values ('callback', $1, $2, $3) returning id`,
          [callId, enquiryId, now],
        )
      ).rows[0]!.id;
    }
    if (decision?.outcome === 'unsure') {
      await tx.query(`insert into public.tasks (type, call_id, enquiry_id, question) values ('unsure', $1, $2, $3)`, [
        callId,
        enquiryId,
        decision.openQuestion,
      ]);
    }
    if (decision?.outcome === 'escalate_complaint') {
      await tx.query(`insert into public.tasks (type, call_id, enquiry_id, question) values ('complaint', $1, $2, $3)`, [
        callId,
        enquiryId,
        extraction?.complaint.summary ?? null,
      ]);
      await tx.query(`insert into public.alerts (type, call_id, details) values ('complaint', $1, $2)`, [
        callId,
        JSON.stringify(extraction?.complaint ?? {}),
      ]);
    }
    if (!decision) {
      await tx.query(`insert into public.alerts (type, call_id, details) values ('extraction_failed', $1, $2)`, [
        callId,
        JSON.stringify({ errors: extracted.attempts.map((a) => a.error) }),
      ]);
    }
    if (leaks.length > 0) {
      await tx.query(`insert into public.alerts (type, call_id, details) values ('price_leak', $1, $2)`, [
        callId,
        JSON.stringify({ hits: leaks }),
      ]);
    }

    const rates = deps.costRates ?? costRatesFromEnv();
    const minutes = Math.round(((interaction.durationSeconds ?? 0) / 60) * 100) / 100;
    const inTok = extracted.attempts.reduce((s, a) => s + (a.inputTokens ?? 0), 0);
    const outTok = extracted.attempts.reduce((s, a) => s + (a.outputTokens ?? 0), 0);
    await tx.query(
      `insert into public.costs (call_id, voice_minutes, voice_cost_inr, llm_input_tokens, llm_output_tokens, llm_cost_inr)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (call_id) do update set voice_minutes = excluded.voice_minutes, voice_cost_inr = excluded.voice_cost_inr,
         llm_input_tokens = excluded.llm_input_tokens, llm_output_tokens = excluded.llm_output_tokens,
         llm_cost_inr = excluded.llm_cost_inr`,
      [
        callId,
        minutes,
        Math.round(minutes * rates.voicePerMinuteInr * 100) / 100,
        inTok,
        outTok,
        (inTok * rates.llmInputPerMTokInr + outTok * rates.llmOutputPerMTokInr) / 1_000_000,
      ],
    );

    return { callId, enquiryId, callbackTaskId };
  });

  // Side-effects after commit, recorded in `actions` so retries don't repeat them.
  let callbackPlaced = false;
  if (stored.callbackTaskId) {
    callbackPlaced = await placeCallback(deps, stored.callId, stored.callbackTaskId, interaction, ops, now);
  }

  return {
    callId: stored.callId,
    enquiryId: stored.enquiryId,
    outcome: decision?.outcome ?? null,
    status,
    flags: decision?.flags ?? [],
    priceLeak: leaks.length > 0,
    callbackPlaced,
    duplicate: false,
  };
}

async function placeCallback(
  deps: PipelineDeps,
  callId: string,
  taskId: string,
  interaction: Interaction,
  ops: OpsConfig,
  now: Date,
): Promise<boolean> {
  const reason = interaction.turns.some((t) => t.speaker === 'caller') ? 'dropped' : 'missed';
  try {
    const { providerCallId } = await deps.voice.startOutboundCall({
      to: interaction.from,
      reason,
      context: reason === 'dropped' ? 'The call dropped earlier; continue the enquiry.' : 'Returning a missed call to Aangan Studio.',
    });
    await deps.db.query(
      `update public.tasks set attempts = attempts + 1, status = 'in_progress',
         next_attempt_at = $2::timestamptz + make_interval(mins => $3)
       where id = $1 and status = 'open'`,
      [taskId, now, ops.callbackRetryMinutes],
    );
    await recordAction(deps.db, callId, 'outbound_callback', 'succeeded', providerCallId, null);
    return true;
  } catch (err) {
    await recordAction(deps.db, callId, 'outbound_callback', 'failed', null, (err as Error).message);
    return false;
  }
}

async function recordAction(
  db: Db,
  callId: string,
  kind: string,
  status: 'succeeded' | 'failed',
  externalId: string | null,
  error: string | null,
): Promise<void> {
  await db.query(
    `insert into public.actions (call_id, kind, status, attempts, external_id, error)
     values ($1, $2::public.action_kind, $3::public.action_status, 1, $4, $5)
     on conflict (call_id, kind) do update set status = excluded.status, attempts = public.actions.attempts + 1,
       external_id = coalesce(excluded.external_id, public.actions.external_id), error = excluded.error`,
    [callId, kind, status, externalId, error],
  );
}
