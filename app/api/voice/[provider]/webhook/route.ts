import { getVoiceProvider } from '@/channels/voice';
import { WebhookAuthError } from '@/channels/voice/VoiceProvider';
import { getPool } from '@/db/client';
import { extractorFromEnv } from '@/llm';
import { getCallerContext, handleCallEnded, type PipelineDeps } from '@/pipeline/processCall';

export const runtime = 'nodejs';
// Extraction can take a few seconds; allow for one retry.
export const maxDuration = 60;

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
  const deps: PipelineDeps = { db, extractor: extractorFromEnv() };

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
  if (!from) return Response.json({ ok: true, ignored: 'unknown caller' }, { status: 202 });

  if (event.type === 'call_started') {
    return Response.json(await getCallerContext(deps, from, event.startedAt));
  }
  return Response.json(await handleCallEnded(deps, { ...event.interaction, from }));
}
