import type { Match } from '@/lib/match';
import type { MatchStage } from '@/lib/stages';

// Browser side of the streaming /api/match (see app/api/match/route.ts).

export type MatchOutcome = { ok: true; match: Match } | { ok: false; status: number; error: string; invalid?: string[] };

export async function requestMatch(
  input: { videoUrls: string[]; brandName: string; category?: string; live?: boolean },
  onStage: (stage: MatchStage) => void,
  signal: AbortSignal
): Promise<MatchOutcome> {
  const res = await fetch('/api/match', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify(input),
    signal,
  });

  // Errors raised before streaming starts (e.g. malformed JSON) come back as plain JSON.
  if (!res.headers.get('content-type')?.includes('ndjson') || !res.body) {
    const d = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: d.error || `Server returned ${res.status}`, invalid: d.invalid };
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
      if (msg.type === 'stage') onStage(msg.stage);
      else if (msg.type === 'result') return { ok: true, match: msg.match };
      else if (msg.type === 'error') return { ok: false, status: msg.status, error: msg.error, invalid: msg.invalid };
    }
    if (done) return { ok: false, status: 500, error: 'The connection closed before a result arrived.' };
  }
}
