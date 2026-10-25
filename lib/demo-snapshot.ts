import snapshot from '@/data/demo-snapshot.json';
import { isDemoInput } from '@/lib/demo-pair';
import type { Match, MatchInput } from '@/lib/match';

// Server-only. data/demo-snapshot.json is a real /api/match result for the demo pair,
// saved by scripts/save-demo-snapshot.mjs from a live, Gemini-backed run.

const stored = snapshot as unknown as Match | null;

// The demo always runs the real pipeline first. Only if that fails (it throws, or
// Gemini was unavailable so no score could be given) is the stored result served,
// clearly labelled with its date (PRODUCT_SPEC §3.3).
export async function withDemoFallback(input: MatchInput, run: () => Promise<Match>): Promise<Match> {
  if (!stored || !isDemoInput(input.videoUrls, input.brandName)) return run();
  try {
    const live = await run();
    if (live.status === 'completed' && live.creator.keywordSource === 'gemini') return live;
  } catch {
    // fall through to the snapshot
  }
  return { ...stored, cachedAt: stored.createdAt };
}
