import type { Interaction } from '../interaction';

export type VoiceEvent =
  /** Before the agent speaks: we answer with caller context for the greeting. */
  | { type: 'call_started'; providerCallId: string; from: string; startedAt: Date }
  /** After hang-up, with the full transcript. */
  | { type: 'call_ended'; interaction: Interaction };

/** Everything the app needs from a voice platform. Vani plugs in behind this. */
export interface VoiceProvider {
  readonly name: string;
  /** Verifies and parses an incoming webhook. Throws WebhookAuthError on a bad signature. */
  parseWebhook(req: Request): Promise<VoiceEvent>;
}

export class WebhookAuthError extends Error {}
