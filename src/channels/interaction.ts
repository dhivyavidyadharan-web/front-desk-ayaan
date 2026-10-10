// Channel-agnostic record of one conversation. Every channel adapter (voice today; WhatsApp or
// the web form later) produces this, and everything downstream only sees this shape.

export interface Turn {
  speaker: 'agent' | 'caller';
  text: string;
  at?: string;
}

export interface Interaction {
  channel: 'voice';
  provider: string;
  providerCallId: string;
  direction: 'inbound' | 'outbound';
  /** Caller's number, E.164. */
  from: string;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  turns: Turn[];
  recordingUrl: string | null;
}
