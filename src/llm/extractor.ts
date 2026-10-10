import type { Interaction } from '../channels/interaction';
import type { Extraction } from '../core/extraction';

/** One model call, kept for the `extractions` table whether or not it was valid. */
export interface ExtractionAttempt {
  attempt: number;
  model: string;
  promptVersion: string;
  rawOutput: string | null;
  parsed: Extraction | null;
  valid: boolean;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ExtractionResult {
  /** Null when every attempt failed → the call is marked needs_review. */
  extraction: Extraction | null;
  attempts: ExtractionAttempt[];
}

export interface Extractor {
  extract(interaction: Interaction): Promise<ExtractionResult>;
}

/** Returns stored extractions by provider call id. Used for the mock provider until Gemini is set up. */
export class FixtureExtractor implements Extractor {
  constructor(private readonly byCallId: Record<string, Extraction>) {}

  async extract(interaction: Interaction): Promise<ExtractionResult> {
    const extraction = this.byCallId[interaction.providerCallId] ?? null;
    return {
      extraction,
      attempts: [
        {
          attempt: 1,
          model: 'fixture',
          promptVersion: 'fixture',
          rawOutput: extraction ? JSON.stringify(extraction) : null,
          parsed: extraction,
          valid: extraction !== null,
          error: extraction ? null : `no fixture for ${interaction.providerCallId}`,
          inputTokens: 0,
          outputTokens: 0,
        },
      ],
    };
  }
}
