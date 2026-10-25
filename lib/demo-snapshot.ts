import snapshot from '@/data/demo-snapshot.json';
import type { PinnedEntities } from '@/lib/creator';
import { isDemoInput } from '@/lib/demo-pair';
import type { Match, MatchInput } from '@/lib/match';

// Server-only. data/demo-snapshot.json is a real /api/match result for the demo pair,
// saved by scripts/save-demo-snapshot.mjs from a live, Gemini-backed run.

const stored = snapshot as unknown as Match | null;

// The demo pair starts from the creator entities Qloo confirmed in that verified run.
// Gemini's extraction can differ slightly between server instances (74 vs 75 on the
// same videos), which would break "same input, same score" (PRODUCT_SPEC §13). The
// videos are still read and every Qloo expansion and affinity is still fetched live.
export function demoPin(input: MatchInput): PinnedEntities | undefined {
  if (!stored || input.pinDemoEntities === false || !isDemoInput(input.videoUrls, input.brandName)) return undefined;
  return { entities: stored.creator.entities, unmatched: stored.creator.unmatched };
}

// If a live demo run fails (Qloo, YouTube or Gemini down), serve the stored result,
// clearly labelled with its date (PRODUCT_SPEC §3.3).
export async function withDemoFallback(input: MatchInput, run: () => Promise<Match>): Promise<Match> {
  if (!stored || !isDemoInput(input.videoUrls, input.brandName)) return run();
  try {
    const live = await run();
    // A heuristic result means Gemini failed and would show a different score than rehearsed.
    if (live.status === 'completed' && live.creator.keywordSource !== 'heuristic') return live;
  } catch {
    // fall through to the snapshot
  }
  return { ...stored, cachedAt: stored.createdAt };
}
