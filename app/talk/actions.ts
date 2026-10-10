'use server';
// Starts a browser call with the Vaani agent. Public: no login, so input is validated and
// sessions are rate-limited per number and overall to cap cost.
import { VaaniVoiceProvider, vaaniConfigFromEnv } from '@/channels/voice/providers/vaani';
import { openingLine } from '@/core/greeting';
import { normalizePhone } from '@/core/phone';
import { getPool } from '@/db/client';
import { FixtureExtractor } from '@/llm/extractor';
import { getCallerContext } from '@/pipeline/processCall';
import { fillTemplate, loadPrompt } from '@/prompts';

export type StartCallResult = { ok: true; token: string; url: string } | { ok: false; error: string };

const LANGS = ['en', 'hi', 'mr'] as const;
type Lang = (typeof LANGS)[number];
const PER_NUMBER_LIMIT = 3; // per 30 minutes
const GLOBAL_LIMIT = 20; // per minute

export async function startWebCall(input: { name: string; phone: string; language: string; consent: boolean }): Promise<StartCallResult> {
  const config = vaaniConfigFromEnv();
  if (!config) return { ok: false, error: 'Calling isn’t available just yet. Please try again soon.' };

  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 60);
  const phone = normalizePhone(input.phone);
  const language = (LANGS as readonly string[]).includes(input.language) ? (input.language as Lang) : 'en';
  if (!name) return { ok: false, error: 'Please tell us your name.' };
  if (!phone) return { ok: false, error: 'Please enter a valid mobile number.' };
  if (!input.consent) return { ok: false, error: 'Please confirm you’re happy for the call to be recorded.' };

  const db = getPool();
  const limits = await db.query<{ mine: number; all: number }>(
    `select count(*) filter (where phone = $1 and created_at > now() - interval '30 minutes')::int as mine,
            count(*) filter (where created_at > now() - interval '1 minute')::int as all
       from public.voice_sessions`,
    [phone],
  );
  if (limits.rows[0]!.mine >= PER_NUMBER_LIMIT) return { ok: false, error: 'You’ve started a few calls already. Please try again in a little while.' };
  if (limits.rows[0]!.all >= GLOBAL_LIMIT) return { ok: false, error: 'Our line is busy right now. Please try again in a minute.' };

  const ctx = await getCallerContext({ db, extractor: new FixtureExtractor({}) }, phone, new Date());
  const prompt = loadPrompt('voice_agent');
  const returningContext = ctx.resuming
    ? `Their previous call dropped a few minutes ago. What we know so far: ${ctx.resuming.summary ?? 'very little'}. Continue from there; don't start the questions over.`
    : ctx.known
      ? 'They have called the studio before.'
      : 'This is their first call to the studio.';
  const systemPrompt = fillTemplate(prompt.text, { caller_name: name, returning_context: returningContext });

  try {
    const session = await new VaaniVoiceProvider(config).createWebSession({
      systemPrompt,
      welcomeMessage: openingLine(language, name, Boolean(ctx.resuming)),
      language,
      metadata: { caller_name: name, caller_phone: phone, returning_context: returningContext },
    });
    await db.query(
      `insert into public.voice_sessions (provider, provider_call_id, phone, name, language, consent_at, agent_prompt_version)
       values ('vaani', $1, $2, $3, $4, now(), $5)`,
      [session.roomName, phone, name, language, prompt.version],
    );
    return { ok: true, token: session.token, url: session.url };
  } catch (err) {
    console.error('startWebCall failed', err);
    return { ok: false, error: 'We couldn’t connect the call. Please try again.' };
  }
}
