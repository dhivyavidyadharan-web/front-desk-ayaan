import { getPool } from '@/db/client';
import { runDailyJobs } from '@/jobs/daily';
import { VaaniVoiceProvider, vaaniConfigFromEnv } from '@/channels/voice/providers/vaani';
import { collectWebCall, uncollectedWebCalls } from '@/pipeline/collectWebCall';
import { extractorFromEnv } from '@/llm';
import { notifierFromEnv } from '@/integrations/notifier';

export const runtime = 'nodejs';

// Vercel cron calls this with "Authorization: Bearer $CRON_SECRET".
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getPool();
  let collected = 0;
  const vaani = vaaniConfigFromEnv();
  if (vaani) {
    const provider = new VaaniVoiceProvider(vaani);
    for (const id of await uncollectedWebCalls(db)) {
      const r = await collectWebCall({ db, extractor: extractorFromEnv(), notifier: notifierFromEnv(db) }, provider, id).catch(() => null);
      if (r?.status === 'done') collected++;
    }
  }
  return Response.json({ ...(await runDailyJobs(db)), callsCollected: collected });
}
