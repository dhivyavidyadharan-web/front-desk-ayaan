import { getPool } from '@/db/client';
import { runDailyJobs } from '@/jobs/daily';

export const runtime = 'nodejs';

// Vercel cron calls this with "Authorization: Bearer $CRON_SECRET".
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return Response.json(await runDailyJobs(getPool()));
}
