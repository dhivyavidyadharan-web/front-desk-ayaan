import type { VoiceProvider } from './VoiceProvider';
import { MockVoiceProvider } from './providers/mock';
import { VaaniVoiceProvider, vaaniConfigFromEnv } from './providers/vaani';

/** Returns the provider for a webhook path segment, or null if it isn't enabled. */
export function getVoiceProvider(name: string): VoiceProvider | null {
  switch (name) {
    case 'mock':
      return new MockVoiceProvider();
    case 'vaani': {
      const config = vaaniConfigFromEnv();
      return config ? new VaaniVoiceProvider(config) : null;
    }
    default:
      return null;
  }
}
