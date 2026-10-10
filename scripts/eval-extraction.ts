// Runs Gemini over the September transcripts and compares the routing decision with the
// expected outcomes (brief §8). Nothing is written to the database.
// Usage: npm run eval
import { pathToFileURL } from 'node:url';
import { DEFAULT_CONFIG } from '@/core/config';
import { decideOutcome } from '@/core/decideOutcome';
import { MockVoiceProvider } from '@/channels/voice/providers/mock';
import { GeminiExtractor, geminiConfigFromEnv } from '@/llm/gemini';
import { SEPTEMBER_EXPECTED, loadSeptemberEvents } from '../fixtures/september';

async function main() {
  const config = geminiConfigFromEnv();
  if (!config) throw new Error('Set GEMINI_API_KEY and GEMINI_MODEL in .env.local first (npm run check-keys lists models).');
  const extractor = new GeminiExtractor(config);
  let right = 0;
  let total = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  for (const raw of loadSeptemberEvents()) {
    const event = MockVoiceProvider.parseEvent(raw);
    if (event.type !== 'call_ended') continue;
    const i = event.interaction;
    const expected = SEPTEMBER_EXPECTED[i.providerCallId] ?? '?';
    const answered = i.answeredAt !== null;
    const r = answered ? await extractor.extract(i) : { extraction: null, attempts: [] };
    tokensIn += r.attempts.reduce((s, a) => s + (a.inputTokens ?? 0), 0);
    tokensOut += r.attempts.reduce((s, a) => s + (a.outputTokens ?? 0), 0);
    const decision = !answered || r.extraction ? decideOutcome({ answered, startedAt: i.startedAt }, r.extraction, DEFAULT_CONFIG) : null;
    const got = decision?.outcome ?? 'needs_review';
    total++;
    if (got === expected) right++;
    const note = decision?.declineReason ?? decision?.openQuestion ?? r.attempts.at(-1)?.error ?? '';
    console.log(`${got === expected ? '✓' : '✗'} ${i.providerCallId.replace('sep-', '').padEnd(5)} expected ${expected.padEnd(19)} got ${got.padEnd(19)} ${note}`);
  }
  console.log(`\n${right}/${total} match. Tokens: ${tokensIn} in, ${tokensOut} out.`);
  console.log('Note: these are human front-desk calls, so some details the bot would have asked for are missing.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
