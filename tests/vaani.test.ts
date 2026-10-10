import { describe, expect, it, vi } from 'vitest';
import { parseTranscriptText } from '@/channels/voice/transcript';
import { VaaniVoiceProvider } from '@/channels/voice/providers/vaani';
import { WebhookAuthError } from '@/channels/voice/VoiceProvider';

const config = { apiKey: 'test-key', agentId: 'b34fd448-d4bd-4bb7-b3ff-95e9c7f85065', webhookSecret: 's3cret-token' };

describe('parseTranscriptText', () => {
  it('parses the timestamped webhook format', () => {
    const turns = parseTranscriptText('[13:33:14] AGENT: Hi! How can I help?\n\n[13:33:19] USER: I have a flat in Baner.');
    expect(turns).toEqual([
      { speaker: 'agent', text: 'Hi! How can I help?', at: '13:33:14' },
      { speaker: 'caller', text: 'I have a flat in Baner.', at: '13:33:19' },
    ]);
  });

  it('parses the call-details format and joins wrapped lines', () => {
    const turns = parseTranscriptText('AGENT: Namaste!\n\n USER: Mera flat\nWakad mein hai.');
    expect(turns).toEqual([
      { speaker: 'agent', text: 'Namaste!' },
      { speaker: 'caller', text: 'Mera flat Wakad mein hai.' },
    ]);
  });

  it('handles empty input', () => {
    expect(parseTranscriptText(null)).toEqual([]);
    expect(parseTranscriptText('')).toEqual([]);
  });
});

const webhook = (body: unknown, token = config.webhookSecret) =>
  new Request(`https://example.test/api/voice/vaani/webhook?token=${token}`, { method: 'POST', body: JSON.stringify(body) });

const postprocessing = {
  event: 'call_postprocessing',
  call_id: 'room-abc',
  timestamp: '2026-10-10T16:10:00+00:00',
  data: {
    call_id: 'room-abc',
    call_duration: 125_400,
    recording_url: 'https://example.test/rec',
    transcript: '[21:38:00] AGENT: Hi Rahul, thank you for calling.\n\n[21:38:05] USER: Hi, I have a 2BHK in Baner.',
  },
};

describe('VaaniVoiceProvider.parseWebhook', () => {
  it('rejects a wrong or missing token', async () => {
    const p = new VaaniVoiceProvider(config);
    await expect(p.parseWebhook(webhook(postprocessing, 'nope'))).rejects.toBeInstanceOf(WebhookAuthError);
    await expect(p.parseWebhook(webhook(postprocessing, ''))).rejects.toBeInstanceOf(WebhookAuthError);
  });

  it('turns call_postprocessing into a finished call', async () => {
    const e = await new VaaniVoiceProvider(config).parseWebhook(webhook(postprocessing));
    expect(e.type).toBe('call_ended');
    if (e.type !== 'call_ended') return;
    expect(e.interaction).toMatchObject({
      provider: 'vaani',
      providerCallId: 'room-abc',
      durationSeconds: 125, // ms in this event
      recordingUrl: 'https://example.test/rec',
      from: '',
    });
    expect(e.interaction.turns).toHaveLength(2);
    expect(e.interaction.endedAt!.getTime() - e.interaction.startedAt.getTime()).toBe(125_000);
    expect(e.interaction.answeredAt).not.toBeNull();
  });

  it('a session where the caller never spoke counts as missed', async () => {
    const silent = { ...postprocessing, data: { ...postprocessing.data, transcript: 'AGENT: Hello? Are you there?' } };
    const e = await new VaaniVoiceProvider(config).parseWebhook(webhook(silent));
    expect(e.type === 'call_ended' && e.interaction.answeredAt).toBeNull();
  });

  it('ignores lifecycle events we do not act on', async () => {
    const e = await new VaaniVoiceProvider(config).parseWebhook(webhook({ event: 'call_ended', room_name: 'room-abc', call_duration: 42.5 }));
    expect(e).toEqual({ type: 'ignored', reason: 'call_ended' });
  });
});

describe('VaaniVoiceProvider.createWebSession', () => {
  it('sends the agent id, script and greeting; the key only in the header', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ token: 'lk-token', room_name: 'room-xyz', connection_url: 'wss://lk.example', live_captions_url: null }),
    );
    const s = await new VaaniVoiceProvider(config, fetchMock as unknown as typeof fetch).createWebSession({
      systemPrompt: 'SCRIPT',
      welcomeMessage: 'Hi Rahul',
      language: 'hi',
      metadata: { caller_name: 'Rahul' },
    });
    expect(s).toEqual({ token: 'lk-token', roomName: 'room-xyz', url: 'wss://lk.example' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.vaanivoice.ai/api/trigger-call/');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('test-key');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      agent_id: config.agentId,
      medium: 'webrtc',
      primary_language: 'hi',
      welcome_message: 'Hi Rahul',
      modify_agent: { persona: { identity: { system_prompt: 'SCRIPT' } } },
    });
    expect(String(init.body)).not.toContain('test-key');
  });

  it('surfaces Vaani errors', async () => {
    const fetchMock = vi.fn(async () => new Response('Insufficient balance', { status: 402 }));
    await expect(
      new VaaniVoiceProvider(config, fetchMock as unknown as typeof fetch).createWebSession({
        systemPrompt: '',
        welcomeMessage: '',
        language: 'en',
        metadata: {},
      }),
    ).rejects.toThrow(/402/);
  });
});
