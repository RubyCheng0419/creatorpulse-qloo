import fitSnapshot from '@/data/demo-snapshot.json';
import mismatchSnapshot from '@/data/demo-snapshot-mismatch.json';
import { DemoPair, findDemoPair } from '@/lib/demo-pair';
import type { Match, MatchInput } from '@/lib/match';

// Server-only. data/demo-snapshot*.json are real /api/match results for the demo pairs,
// saved by scripts/save-demo-snapshot.mjs from live, Gemini-backed runs.

const stored: Record<DemoPair['key'], Match | null> = {
  fit: fitSnapshot as unknown as Match | null,
  mismatch: mismatchSnapshot as unknown as Match | null,
};

// The demos always run the real pipeline first. Only if that fails (it throws, or
// Gemini was unavailable so no score could be given) is the stored result served,
// clearly labelled with its date (PRODUCT_SPEC §3.3).
export async function withDemoFallback(input: MatchInput, run: () => Promise<Match>): Promise<Match> {
  const pair = findDemoPair(input.videoUrls, input.brandName);
  const snapshot = pair && stored[pair.key];
  if (!snapshot) return run();
  try {
    const live = await run();
    if (live.status === 'completed' && live.creator.keywordSource === 'gemini') return live;
  } catch {
    // fall through to the snapshot
  }
  return { ...snapshot, cachedAt: snapshot.createdAt };
}
