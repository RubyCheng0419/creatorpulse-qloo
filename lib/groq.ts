// Server-only. Fallback LLM for name extraction when Gemini is over quota or overloaded.
// Like Gemini it only proposes search terms; Qloo's exact match decides what counts.
// Groq's API is OpenAI-compatible: POST /chat/completions with a JSON schema.

export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const TIMEOUT_MS = 15000;

export function hasGroq(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

// Same contract as geminiJson: parsed JSON matching `schema`, or a thrown error that
// carries the HTTP status. One attempt only; the caller already tried Gemini.
export async function groqJson<T>(system: string, user: string, schema: object, temperature = 0): Promise<T> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw Error('GROQ_API_KEY is not set. Check .env.local.');

  const r = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature,
      reasoning_effort: 'low', // extraction needs little reasoning
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'result', schema } },
    }),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(Error(d?.error?.message || `Groq returned ${r.status}`), { status: r.status });
  const text = d?.choices?.[0]?.message?.content;
  if (!text) throw Error('Groq returned no content.');
  return JSON.parse(text) as T;
}
