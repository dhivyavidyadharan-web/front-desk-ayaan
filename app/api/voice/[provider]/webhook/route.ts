import { createHash } from 'node:crypto';
import { getVoiceProvider } from '@/channels/voice';
import { WebhookAuthError } from '@/channels/voice/VoiceProvider';
import { getPool } from '@/db/client';
import { extractorFromEnv } from '@/llm';
import { notifierFromEnv } from '@/integrations/notifier';
import { getCallerContext, handleCallEnded, type PipelineDeps } from '@/pipeline/processCall';

export const runtime = 'nodejs';
// Extraction can take a few seconds; allow for one retry.
export const maxDuration = 60;

/** A stable, obviously-fake E.164 number for a call with no caller ID (+999 is not a real country code). */
function placeholderNumber(callId: string): string {
  const digits = createHash('sha256').update(callId).digest('hex').replace(/[^0-9]/g, '').padEnd(9, '0').slice(0, 9);
  return `+999${digits}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const voice = getVoiceProvider(provider);
  if (!voice) return Response.json({ error: 'unknown provider' }, { status: 404 });

  let event;
  try {
    event = await voice.parseWebhook(req);
  } catch (err) {
    if (err instanceof WebhookAuthError) return Response.json({ error: 'unauthorized' }, { status: 401 });
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  if (event.type === 'ignored') return Response.json({ ok: true, ignored: event.reason });

  const db = getPool();
  const deps: PipelineDeps = { db, extractor: extractorFromEnv(), notifier: notifierFromEnv(db) };

  // Browser calls carry no caller ID: find who started the session.
  const providerCallId = event.type === 'call_started' ? event.providerCallId : event.interaction.providerCallId;
  let from = event.type === 'call_started' ? event.from : event.interaction.from;
  if (!from) {
    const s = await db.query<{ phone: string }>(
      'select phone from public.voice_sessions where provider = $1 and provider_call_id = $2',
      [provider, providerCallId],
    );
    from = s.rows[0]?.phone ?? '';
  }
  // Calls started outside our /talk page (e.g. Vaani's own Test button) carry no number. Keep them
  // anyway under a stable placeholder number, so every call reaches the dashboard; the caller's
  // name still comes from the conversation.
  if (!from) from = placeholderNumber(providerCallId);

  if (event.type === 'call_started') {
    return Response.json(await getCallerContext(deps, from, event.startedAt));
  }
  return Response.json(await handleCallEnded(deps, { ...event.interaction, from }));
}
