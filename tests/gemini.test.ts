import { describe, expect, it, vi } from 'vitest';
import { GeminiExtractor, userMessage } from '@/llm/gemini';
import type { Interaction } from '@/channels/interaction';
import { BASE_EXTRACTION } from '../fixtures/extractionBuilder';

const interaction: Interaction = {
  channel: 'voice',
  provider: 'vaani',
  providerCallId: 'room-1',
  direction: 'inbound',
  from: '+919800000042',
  startedAt: new Date('2026-10-09T21:40:00+05:30'),
  answeredAt: new Date('2026-10-09T21:40:00+05:30'),
  endedAt: new Date('2026-10-09T21:44:00+05:30'),
  durationSeconds: 240,
  turns: [
    { speaker: 'agent', text: 'Hi Rahul, how can I help?' },
    { speaker: 'caller', text: 'I have a 2BHK in Baner.' },
  ],
  recordingUrl: null,
};

const reply = (text: string, status = 200) =>
  status === 200
    ? Response.json({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300 } })
    : new Response(text, { status });

const extractor = (fetchMock: ReturnType<typeof vi.fn>) =>
  new GeminiExtractor({ apiKey: 'k', model: 'test-flash' }, fetchMock as unknown as typeof fetch);

describe('GeminiExtractor', () => {
  it('accepts valid JSON on the first try and records tokens', async () => {
    const fetchMock = vi.fn(async () => reply(JSON.stringify(BASE_EXTRACTION)));
    const r = await extractor(fetchMock).extract(interaction);
    expect(r.extraction).not.toBeNull();
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]).toMatchObject({ valid: true, inputTokens: 1200, outputTokens: 300, model: 'test-flash' });
    expect(r.attempts[0]!.promptVersion).toMatch(/^extraction@[0-9a-f]{10}$/);
  });

  it('never trusts a model-written phone number', async () => {
    const fetchMock = vi.fn(async () => reply(JSON.stringify({ ...BASE_EXTRACTION, caller: { ...BASE_EXTRACTION.caller, phone: '+910000000000' } })));
    const r = await extractor(fetchMock).extract(interaction);
    expect(r.extraction?.caller.phone).toBe('+919800000042');
  });

  it('retries once after invalid JSON, telling the model what went wrong', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply('not json')).mockResolvedValueOnce(reply(JSON.stringify(BASE_EXTRACTION)));
    const r = await extractor(fetchMock).extract(interaction);
    expect(r.extraction).not.toBeNull();
    expect(r.attempts.map((a) => a.valid)).toEqual([false, true]);
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(secondBody.contents.at(-1).parts[0].text).toMatch(/not valid JSON/);
  });

  it('gives up after two schema failures → needs review', async () => {
    const bad = JSON.stringify({ ...BASE_EXTRACTION, intent: 'sales_pitch' });
    const fetchMock = vi.fn(async () => reply(bad));
    const r = await extractor(fetchMock).extract(interaction);
    expect(r.extraction).toBeNull();
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[1]!.error).toMatch(/intent/);
  });

  it('records HTTP errors', async () => {
    const fetchMock = vi.fn(async () => reply('quota exceeded', 429));
    const r = await extractor(fetchMock).extract(interaction);
    expect(r.extraction).toBeNull();
    expect(r.attempts[0]!.error).toMatch(/429/);
  });

  it('sends the key in a header, not the URL, and asks for JSON', async () => {
    const fetchMock = vi.fn(async () => reply(JSON.stringify(BASE_EXTRACTION)));
    await extractor(fetchMock).extract(interaction);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/test-flash:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    expect(JSON.parse(String(init.body)).generationConfig.responseMimeType).toBe('application/json');
  });

  it('gives the model the call date and caller phone', () => {
    const m = userMessage(interaction);
    expect(m).toContain('+919800000042');
    expect(m).toContain('2026');
    expect(m).toContain('CALLER: I have a 2BHK in Baner.');
  });
});
