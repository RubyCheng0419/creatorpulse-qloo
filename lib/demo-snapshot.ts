import snapshot from '@/data/demo-snapshot.json';
import { isDemoInput } from '@/lib/demo-pair';
import type { Match, MatchInput } from '@/lib/match';

// Server-only. data/demo-snapshot.json is a real /api/match result for the demo pair,
// saved by scripts/save-demo-snapshot.mjs. It is served, clearly labelled with its
// date, only when a live demo run fails (PRODUCT_SPEC §3.3), so the demo still shows
// genuine Qloo evidence if Qloo, YouTube or Gemini is down on demo day.

const stored = snapshot as unknown as Match | null;

// A live demo run "fails" when it throws, or when Gemini was unavailable and the
// weaker rule-based keywords would show a different score than the rehearsed one.
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
