// A finished /talk call is collected from Vaani (transcript API faked) into the TEST branch.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VaaniVoiceProvider } from '@/channels/voice/providers/vaani';
import { createPool, type Db } from '@/db/client';
import { FixtureExtractor } from '@/llm/extractor';
import { collectWebCall } from '@/pipeline/collectWebCall';
import { extraction } from '../../fixtures/extractionBuilder';

const enabled = Boolean(process.env.DATABASE_URL_TEST);
const PHONE = '+919844400001';
const ROOM = 'itest-collect-room';

describe.skipIf(!enabled)('collecting a finished /talk call from Vaani', () => {
  let db: Db;
  let transcript: string | null = null;
  const fakeFetch = (async () =>
    transcript ? Response.json({ transcript, status_code: 200 }) : Response.json({ transcript: 'Transcript not found', status_code: 404 }, { status: 404 })) as unknown as typeof fetch;
  const vaani = new VaaniVoiceProvider({ apiKey: 'k', agentId: 'a', webhookSecret: 's' }, fakeFetch);

  beforeAll(async () => {
    db = createPool(process.env.DATABASE_URL_TEST!);
    await db.query(`delete from calls where provider_call_id = $1`, [ROOM]);
    await db.query(`delete from voice_sessions where provider_call_id = $1`, [ROOM]);
    await db.query(`delete from callers where phone = $1`, [PHONE]);
    await db.query(`insert into voice_sessions (provider, provider_call_id, phone, name, language, consent_at) values ('vaani', $1, $2, 'Divya Vijay', 'en', now() - interval '4 minutes')`, [ROOM, PHONE]);
  });
  afterAll(async () => db?.end());

  const deps = () => ({ db, extractor: new FixtureExtractor({ [ROOM]: extraction({ caller: { name: 'Divya Vijay', phone: PHONE } }) }) });

  it('waits while Vaani is still preparing the transcript', async () => {
    expect((await collectWebCall(deps(), vaani, ROOM)).status).toBe('pending');
  });

  it('stores and processes the call once the transcript is ready', async () => {
    transcript = 'AGENT: Good evening, Divya!\n\n USER: Hi, I have a 3BHK in Kothrud and want full interiors done by March.';
    const r = await collectWebCall(deps(), vaani, ROOM);
    expect(r.status).toBe('done');
    const row = (await db.query(`select from_number, outcome, jsonb_array_length(transcript) as turns from calls where provider_call_id = $1`, [ROOM])).rows[0];
    expect(row).toEqual({ from_number: PHONE, outcome: 'qualified', turns: 2 });
  });

  it('unknown calls are ignored', async () => {
    expect((await collectWebCall(deps(), vaani, 'not-ours')).status).toBe('unknown');
  });
});
