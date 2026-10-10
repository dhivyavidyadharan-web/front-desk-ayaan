import type { VoiceProvider } from './VoiceProvider';
import { MockVoiceProvider } from './providers/mock';

/** Returns the provider for a webhook path segment, or null if it isn't enabled. */
export function getVoiceProvider(name: string): VoiceProvider | null {
  switch (name) {
    case 'mock':
      return new MockVoiceProvider();
    // case 'vani': added once Vani access is available.
    default:
      return null;
  }
}
