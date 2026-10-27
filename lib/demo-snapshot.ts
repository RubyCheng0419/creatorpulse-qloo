import fitSnapshot from '@/data/demo-snapshot.json';
import mismatchSnapshot from '@/data/demo-snapshot-mismatch.json';
import { DemoPair, findDemoPair } from '@/lib/demo-pair';
import type { Match, MatchInput } from '@/lib/match';

// Server-only. data/demo-snapshot*.json are real /api/match results for the demo pairs,
// saved by scripts/save-demo-snapshot.mjs from live, LLM-backed runs.

const stored: Record<DemoPair['key'], Match | null> = {
  fit: fitSnapshot as unknown as Match | null,
  mismatch: mismatchSnapshot as unknown as Match | null,
};

// A demo click serves the stored result, labelled with its date, so repeated clicks during
// judging spend no Gemini, Groq, YouTube or Qloo quota. "Run live" ({ live: true }) runs the
// real pipeline; only if that fails (it throws, or no LLM could give a score) is the stored
// result served instead, labelled as a fallback.
export async function withDemoFallback(input: MatchInput, run: () => Promise<Match>): Promise<Match> {
  const pair = findDemoPair(input.videoUrls, input.brandName);
  const snapshot = pair && stored[pair.key];
  if (!snapshot) return run();
  if (input.live !== true) return { ...snapshot, cachedAt: snapshot.createdAt, cachedReason: 'demo' };
  try {
    const live = await run();
    if (live.status === 'completed' && live.creator.keywordSource !== 'unavailable') return live;
  } catch {
    // fall through to the snapshot
  }
  return { ...snapshot, cachedAt: snapshot.createdAt, cachedReason: 'fallback' };
}
