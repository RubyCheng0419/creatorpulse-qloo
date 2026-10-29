import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { caught } from '@/lib/errors';

// Server-only. The LLM never produces scores or taste entities (PRODUCT_SPEC §5.5):
// it only proposes search terms and writes text around Qloo evidence.

// Tested with this key on 2026-10-25: gemini-2.5-flash returns 404 "no longer available
// to new users"; gemini-3.8-flash never answered (45s+, also over plain REST);
// gemini-3.5-flash with LOW thinking answered in ~1.6s but sometimes returns 503.
export const GEMINI_MODEL = 'gemini-3.5-flash';
const TIMEOUT_MS = 15000;

let client: GoogleGenAI | null = null;

export function hasGemini(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

// Returns parsed JSON matching `schema`. Throws when the key is missing or the call
// fails; callers fall back to non-LLM behaviour.
// An image (e.g. a brand's key visual) can be sent along with the text.
export interface InlineImage {
  data: string; // base64, no data: prefix
  mimeType: string;
}

export async function geminiJson<T>(system: string, user: string, schema: object, temperature = 0, image?: InlineImage): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Error('GEMINI_API_KEY is not set. Check .env.local.');
  client ??= new GoogleGenAI({ apiKey });

  // Retry once when Google reports overload (503/429). Timeouts are not retried:
  // a second 15s wait would push a match past the 20s target (§3.1).
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: image ? [{ inlineData: image }, { text: user }] : user,
        config: {
          systemInstruction: system,
          temperature,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, // extraction needs little reasoning
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        },
      });
      if (!res.text) throw Error('Gemini returned no content.');
      return JSON.parse(res.text) as T;
    } catch (e) {
      const { status } = caught(e);
      const overloaded = status === 503 || status === 429;
      if (!overloaded || attempt > 0) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
