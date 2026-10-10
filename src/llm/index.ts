import { FixtureExtractor, type Extractor } from './extractor';
import { GeminiExtractor, geminiConfigFromEnv } from './gemini';

/** Gemini when configured; otherwise calls are stored and marked needs_review. */
export function extractorFromEnv(): Extractor {
  const config = geminiConfigFromEnv();
  return config ? new GeminiExtractor(config) : new FixtureExtractor({});
}
