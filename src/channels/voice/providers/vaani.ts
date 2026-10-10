// Vaani (vaanivoice.ai). Docs: https://docs.vaanivoice.ai/llms.txt
//   Sessions: POST /api/trigger-call/ with medium "webrtc" → LiveKit token + URL for the browser.
//   Webhooks: Vaani does not sign them, so the URL carries a secret token (?token=...).
//   The transcript arrives in the `call_postprocessing` event.
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { VoiceEvent, VoiceProvider } from '../VoiceProvider';
import { WebhookAuthError } from '../VoiceProvider';
import { parseTranscriptText } from '../transcript';

const API = 'https://api.vaanivoice.ai';

export interface VaaniConfig {
  apiKey: string;
  agentId: string;
  webhookSecret: string;
}

export function vaaniConfigFromEnv(env = process.env): VaaniConfig | null {
  const { VAANI_API_KEY: apiKey, VAANI_AGENT_ID: agentId, VAANI_WEBHOOK_SECRET: webhookSecret } = env;
  return apiKey && agentId && webhookSecret ? { apiKey, agentId, webhookSecret } : null;
}

const sessionResponse = z.object({
  token: z.string(),
  room_name: z.string(),
  connection_url: z.string(),
  live_captions_url: z.string().nullish(),
});

export interface WebSessionRequest {
  systemPrompt: string;
  welcomeMessage: string;
  language: 'en' | 'hi' | 'mr';
  metadata: Record<string, string>;
}

const webhookSchema = z
  .object({
    event: z.string(),
    room_name: z.string().optional(),
    call_id: z.string().optional(),
    phone_number: z.string().optional(),
    timestamp: z.string().optional(),
    data: z
      .object({
        room_name: z.string().optional(),
        call_id: z.string().optional(),
        call_duration: z.number().optional(), // milliseconds in call_postprocessing
        transcript: z.string().nullish(),
        recording_url: z.string().nullish(),
        summary: z.string().nullish(),
        end_reason: z.string().nullish(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export class VaaniVoiceProvider implements VoiceProvider {
  readonly name = 'vaani';

  constructor(
    private readonly config: VaaniConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Starts an in-browser session. The API key never leaves the server. */
  async createWebSession(req: WebSessionRequest) {
    const res = await this.fetchImpl(`${API}/api/trigger-call/`, {
      method: 'POST',
      headers: { 'X-API-Key': this.config.apiKey, 'X-Agent-Id': 'aangan-web', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: this.config.agentId,
        medium: 'webrtc',
        metadata: req.metadata,
        primary_language: req.language,
        secondary_language: 'en',
        voice_gender: 'female',
        welcome_message: req.welcomeMessage,
        welcome_interruptible: true,
        modify_agent: { persona: { identity: { system_prompt: req.systemPrompt } } },
      }),
    });
    if (!res.ok) throw new Error(`Vaani session failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const body = sessionResponse.parse(await res.json());
    return { token: body.token, roomName: body.room_name, url: body.connection_url };
  }

  async parseWebhook(req: Request): Promise<VoiceEvent> {
    const token = new URL(req.url).searchParams.get('token') ?? '';
    const a = Buffer.from(token);
    const b = Buffer.from(this.config.webhookSecret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookAuthError('invalid Vaani webhook token');
    return VaaniVoiceProvider.toEvent(webhookSchema.parse(await req.json()));
  }

  static toEvent(p: z.infer<typeof webhookSchema>): VoiceEvent {
    const callId = p.data?.call_id ?? p.data?.room_name ?? p.call_id ?? p.room_name;
    if (!callId) return { type: 'ignored', reason: 'no call id' };

    if (p.event === 'call_started') {
      return { type: 'call_started', providerCallId: callId, from: p.phone_number ?? '', startedAt: new Date() };
    }
    if (p.event !== 'call_postprocessing') return { type: 'ignored', reason: p.event };

    const turns = parseTranscriptText(p.data?.transcript);
    const endedAt = p.timestamp ? new Date(p.timestamp) : new Date();
    const durationSeconds = p.data?.call_duration != null ? Math.round(p.data.call_duration / 1000) : null;
    const startedAt = durationSeconds != null ? new Date(endedAt.getTime() - durationSeconds * 1000) : endedAt;
    // A session where the caller never spoke is treated like a missed call.
    const callerSpoke = turns.some((t) => t.speaker === 'caller');
    return {
      type: 'call_ended',
      interaction: {
        channel: 'voice',
        provider: 'vaani',
        providerCallId: callId,
        direction: 'inbound',
        from: p.phone_number ?? '', // browser calls: filled from voice_sessions by the webhook route
        startedAt,
        answeredAt: callerSpoke ? startedAt : null,
        endedAt,
        durationSeconds,
        turns,
        recordingUrl: p.data?.recording_url ?? null,
      },
    };
  }
}
