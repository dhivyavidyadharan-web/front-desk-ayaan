import { getVoiceProvider } from '@/channels/voice';
import { WebhookAuthError } from '@/channels/voice/VoiceProvider';
import { getPool } from '@/db/client';
import { FixtureExtractor } from '@/llm/extractor';
import { getCallerContext, handleCallEnded, type PipelineDeps } from '@/pipeline/processCall';

export const runtime = 'nodejs';

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

  const deps: PipelineDeps = {
    db: getPool(),
    // Gemini replaces this in the next step; until then calls without a fixture go to needs_review.
    extractor: new FixtureExtractor({}),
    voice,
  };

  if (event.type === 'call_started') {
    return Response.json(await getCallerContext(deps, event.from, event.startedAt));
  }
  return Response.json(await handleCallEnded(deps, event.interaction));
}
