'use client';

import { findDemoPair } from '@/lib/demo-pair';
import type { Match } from '@/lib/match';
import { useRuns } from '@/lib/score-log';

const SHARP = 15; // a dimension that moved this much since the previous run is called out

// One run is not a fixed score: the names the LLM proposes vary between runs, and the score
// with them. Shows this run beside the pair's recorded range (demo pairs, docs/DEMO_PAIR.md)
// and the runs logged on this device, and the dimensions that moved sharply since the last one.
export function ScoreRange({ match }: { match: Match }) {
  const runs = useRuns(match.id); // localStorage: null until rendered in the browser
  const fit = match.compatibility.fitScore;
  if (fit === null || runs === null) return null;

  const demo = findDemoPair(match.creator.videoUrls, match.brand.name);
  const scores = runs.map((r) => r.fit);
  const lo = Math.min(...scores, fit);
  const hi = Math.max(...scores, fit);
  const previous = runs.find((r) => r.at !== match.createdAt);
  const moved = previous
    ? match.compatibility.dimensions
        .map((d) => ({ label: d.label, now: d.score, then: previous.dims[d.label] ?? null }))
        .filter((d) => d.now !== null && d.then !== null && Math.abs(d.now - d.then) >= SHARP)
    : [];

  return (
    <div className="mt-1 max-w-xs text-xs text-slate-500">
      <p>
        <span className="font-medium text-slate-700">{fit} this run</span>
        {demo && (
          <>
            {' '}
            · {demo.recorded.min}–{demo.recorded.max} in recorded live runs ({demo.recorded.period})
          </>
        )}
        {runs.length > 1 ? (
          <>
            {' '}
            · {lo === hi ? lo : `${lo}–${hi}`} across your last {runs.length} runs on this device
          </>
        ) : (
          !demo && <> · a single run, not a fixed score: re-runs move with the names the LLM proposes</>
        )}
      </p>
      {moved.length > 0 && (
        <p className="mt-0.5 text-amber-800">
          Moved sharply since the previous run: {moved.map((d) => `${d.label} ${d.then} → ${d.now}`).join(', ')}
        </p>
      )}
    </div>
  );
}
