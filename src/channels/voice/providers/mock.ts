// Stand-in voice provider until Vani access arrives. Accepts our own JSON events (used by
// scripts/replay.ts and tests) and pretends to place outbound calls.
import { z } from 'zod';
import type { OutboundCallRequest, VoiceEvent, VoiceProvider } from '../VoiceProvider';
import { WebhookAuthError } from '../VoiceProvider';

const turnSchema = z.object({ speaker: z.enum(['agent', 'caller']), text: z.string(), at: z.string().optional() });

const eventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('call_started'),
    providerCallId: z.string(),
    from: z.string(),
    startedAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('call_ended'),
    providerCallId: z.string(),
    from: z.string(),
    direction: z.enum(['inbound', 'outbound']).default('inbound'),
    startedAt: z.coerce.date(),
    answeredAt: z.coerce.date().nullable(),
    endedAt: z.coerce.date().nullable(),
    durationSeconds: z.number().nullable(),
    turns: z.array(turnSchema),
    recordingUrl: z.string().nullable().default(null),
  }),
]);

export type MockEvent = z.input<typeof eventSchema>;

export class MockVoiceProvider implements VoiceProvider {
  readonly name = 'mock';
  readonly outboundCalls: OutboundCallRequest[] = [];

  constructor(private readonly secret: string | undefined = process.env.MOCK_WEBHOOK_SECRET) {}

  async parseWebhook(req: Request): Promise<VoiceEvent> {
    if (!this.secret || req.headers.get('x-webhook-secret') !== this.secret) {
      throw new WebhookAuthError('invalid mock webhook secret');
    }
    return MockVoiceProvider.toVoiceEvent(eventSchema.parse(await req.json()));
  }

  static toVoiceEvent(e: z.output<typeof eventSchema>): VoiceEvent {
    if (e.type === 'call_started') return e;
    return {
      type: 'call_ended',
      interaction: {
        channel: 'voice',
        provider: 'mock',
        providerCallId: e.providerCallId,
        direction: e.direction,
        from: e.from,
        startedAt: e.startedAt,
        answeredAt: e.answeredAt,
        endedAt: e.endedAt,
        durationSeconds: e.durationSeconds,
        turns: e.turns,
        recordingUrl: e.recordingUrl,
      },
    };
  }

  static parseEvent(input: MockEvent): VoiceEvent {
    return MockVoiceProvider.toVoiceEvent(eventSchema.parse(input));
  }

  async startOutboundCall(req: OutboundCallRequest): Promise<{ providerCallId: string }> {
    this.outboundCalls.push(req);
    return { providerCallId: `mock-out-${crypto.randomUUID()}` };
  }
}
