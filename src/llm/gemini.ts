// Post-call extraction with Gemini (model from GEMINI_MODEL). The answer must parse as JSON and
// pass ExtractionSchema; one retry with the validation errors, then the call goes to needs_review.
import { z } from 'zod';
import type { Interaction } from '../channels/interaction';
import { ExtractionSchema } from '../core/extraction';
import { loadPrompt } from '../prompts';
import type { ExtractionAttempt, ExtractionResult, Extractor } from './extractor';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_ATTEMPTS = 2;

export interface GeminiConfig {
  apiKey: string;
  model: string;
}

export function geminiConfigFromEnv(env = process.env): GeminiConfig | null {
  return env.GEMINI_API_KEY && env.GEMINI_MODEL ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : null;
}

const responseSchema = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional() }))
    .optional(),
  usageMetadata: z.object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional() }).optional(),
});

function systemPrompt(): { text: string; version: string } {
  const { text, version } = loadPrompt('extraction');
  const schema = JSON.stringify(z.toJSONSchema(ExtractionSchema, { io: 'input' }));
  return { text: `${text}\n\n## JSON schema\n\n${schema}`, version };
}

export function userMessage(interaction: Interaction): string {
  const when = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' }).format(interaction.startedAt);
  const transcript = interaction.turns.map((t) => `${t.speaker === 'agent' ? 'AGENT' : 'CALLER'}: ${t.text}`).join('\n');
  return `Call date and time (Asia/Kolkata): ${when}\nCaller phone: ${interaction.from}\n\nTranscript:\n${transcript}`;
}

export class GeminiExtractor implements Extractor {
  constructor(
    private readonly config: GeminiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async extract(interaction: Interaction): Promise<ExtractionResult> {
    const { text: system, version } = systemPrompt();
    const attempts: ExtractionAttempt[] = [];
    const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [
      { role: 'user', parts: [{ text: userMessage(interaction) }] },
    ];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const record: ExtractionAttempt = {
        attempt,
        model: this.config.model,
        promptVersion: version,
        rawOutput: null,
        parsed: null,
        valid: false,
        error: null,
        inputTokens: null,
        outputTokens: null,
      };
      attempts.push(record);
      try {
        const res = await this.fetchImpl(`${API}/models/${encodeURIComponent(this.config.model)}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': this.config.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: { responseMimeType: 'application/json', temperature: 0 },
          }),
        });
        if (!res.ok) {
          record.error = `Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
          continue;
        }
        const body = responseSchema.parse(await res.json());
        record.inputTokens = body.usageMetadata?.promptTokenCount ?? null;
        record.outputTokens = body.usageMetadata?.candidatesTokenCount ?? null;
        const raw = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        record.rawOutput = raw;

        let json: unknown;
        try {
          json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
        } catch {
          record.error = 'Response was not valid JSON';
          contents.push({ role: 'model', parts: [{ text: raw }] }, { role: 'user', parts: [{ text: 'That was not valid JSON. Return only the JSON object.' }] });
          continue;
        }
        // The phone is known; never trust a model-written one.
        if (json && typeof json === 'object' && 'caller' in json && json.caller && typeof json.caller === 'object') {
          (json.caller as Record<string, unknown>).phone = interaction.from;
        }
        const parsed = ExtractionSchema.safeParse(json);
        if (parsed.success) {
          record.parsed = parsed.data;
          record.valid = true;
          return { extraction: parsed.data, attempts };
        }
        record.error = z.prettifyError(parsed.error).slice(0, 1000);
        contents.push(
          { role: 'model', parts: [{ text: raw }] },
          { role: 'user', parts: [{ text: `That JSON did not match the schema:\n${record.error}\nReturn the corrected JSON object only.` }] },
        );
      } catch (err) {
        record.error = `Gemini request failed: ${(err as Error).message}`;
      }
    }
    return { extraction: null, attempts };
  }
}
