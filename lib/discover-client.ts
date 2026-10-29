import type { Discovery } from '@/lib/discover';
import type { DiscoverProgress } from '@/lib/stages';

// Browser side of the streaming /api/discover (see app/api/discover/route.ts and lib/match-client).

export type DiscoverOutcome = { ok: true; discovery: Discovery } | { ok: false; status: number; error: string };

export async function requestDiscover(
  input: object,
  onProgress: (p: DiscoverProgress) => void,
  signal: AbortSignal
): Promise<DiscoverOutcome> {
  const res = await fetch('/api/discover', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify(input),
    signal,
  });

  // Errors raised before streaming starts (rate limit, malformed JSON, a 504) come back as plain JSON or HTML.
  if (!res.headers.get('content-type')?.includes('ndjson') || !res.body) {
    const d = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: d.error || `Server returned ${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'progress') onProgress({ stage: msg.stage, finished: msg.finished, done: msg.done, of: msg.of });
      else if (msg.type === 'result') return { ok: true, discovery: msg.discovery };
      else if (msg.type === 'error') return { ok: false, status: msg.status, error: msg.error };
    }
    if (done) return { ok: false, status: 500, error: 'The connection closed before a result arrived.' };
  }
}
