// Pulls a finished browser call's transcript from Vaani and runs it through the pipeline.
// Used when the caller hangs up on /talk (and by the daily job as a backup), so calls reach the
// dashboard even if Vaani's webhook never arrives.
import { parseTranscriptText } from '../channels/voice/transcript';
import type { VaaniVoiceProvider } from '../channels/voice/providers/vaani';
import type { Db } from '../db/client';
import { handleCallEnded, type PipelineDeps, type ProcessResult } from './processCall';

export type CollectResult = { status: 'done'; result: ProcessResult } | { status: 'pending' } | { status: 'unknown' };

export async function collectWebCall(deps: PipelineDeps & { db: Db }, vaani: VaaniVoiceProvider, callId: string): Promise<CollectResult> {
  const session = (
    await deps.db.query<{ phone: string; created_at: Date }>(
      `select phone, created_at from public.voice_sessions where provider = 'vaani' and provider_call_id = $1`,
      [callId],
    )
  ).rows[0];
  if (!session) return { status: 'unknown' };

  const text = await vaani.fetchTranscript(callId);
  if (!text) return { status: 'pending' };

  const turns = parseTranscriptText(text);
  const now = new Date();
  const startedAt = new Date(session.created_at);
  const result = await handleCallEnded(deps, {
    channel: 'voice',
    provider: 'vaani',
    providerCallId: callId,
    direction: 'inbound',
    from: session.phone,
    startedAt,
    answeredAt: turns.some((t) => t.speaker === 'caller') ? startedAt : null,
    endedAt: now,
    durationSeconds: Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000)),
    turns,
    recordingUrl: null,
  });
  return { status: 'done', result };
}

/** Browser calls from the last two days that never reached the pipeline. */
export async function uncollectedWebCalls(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select s.provider_call_id as id from public.voice_sessions s
      where s.provider = 'vaani' and s.created_at > now() - interval '2 days' and s.created_at < now() - interval '2 minutes'
        and not exists (select 1 from public.calls c where c.provider = 'vaani' and c.provider_call_id = s.provider_call_id)`,
  );
  return rows.map((r) => r.id);
}
