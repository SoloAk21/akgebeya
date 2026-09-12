import { z } from 'zod';
import type { GeminiConfig } from '../config.js';
import { HttpError } from '../errors.js';
import { listingAiInstructions, type ListingAiClient, type ListingAiInput } from './ai.js';

const envelopeSchema = z.object({
  candidates: z.array(z.object({
    finishReason: z.literal('STOP'),
    content: z.object({ parts: z.array(z.object({ text: z.string(), thought: z.boolean().optional(), thoughtSignature: z.string().optional() }).strict()).min(1).max(8) }),
  })).length(1),
});
const outputSchema = {
  type: 'OBJECT', properties: {
    titleEn: { type: 'STRING' }, titleAm: { type: 'STRING' },
    descriptionEn: { type: 'STRING' }, descriptionAm: { type: 'STRING' },
  }, required: ['titleEn', 'titleAm', 'descriptionEn', 'descriptionAm'],
};
const transportErrors = new Set(['AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_RATE_LIMITED', 'AI_OUTPUT_INVALID']);
export class GeminiListingAiClient implements ListingAiClient {
  constructor(private readonly config: GeminiConfig, private readonly request: typeof fetch = fetch) {}
  async generate(input: ListingAiInput): Promise<string> {
    if (!this.config.apiKey || !this.config.model) throw new HttpError('AI_UNAVAILABLE');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.request(
        'https://generativelanguage.googleapis.com/v1beta/models/' + this.config.model + ':generateContent', {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.config.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: listingAiInstructions }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
            generationConfig: { responseMimeType: 'application/json', responseSchema: outputSchema, candidateCount: 1, maxOutputTokens: 8192 },
          }),
        });
      if (!response.ok) {
        await response.body?.cancel();
        throw new HttpError(response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_UNAVAILABLE');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new HttpError('AI_OUTPUT_INVALID');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 131072) throw new HttpError('AI_OUTPUT_INVALID');
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new HttpError('AI_OUTPUT_INVALID'); }
      const parsed = envelopeSchema.safeParse(body);
      if (!parsed.success) throw new HttpError('AI_OUTPUT_INVALID');
      const parts = parsed.data.candidates[0]!.content.parts.filter(part => !part.thought);
      if (parts.length !== 1) throw new HttpError('AI_OUTPUT_INVALID');
      return parts[0]!.text;
    } catch (error) {
      if (controller.signal.aborted) throw new HttpError('AI_TIMEOUT');
      if (error instanceof HttpError && transportErrors.has(error.code)) throw error;
      throw new HttpError('AI_UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
}
