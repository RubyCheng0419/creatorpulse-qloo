import type { CreatorCandidate, Discovery } from '@/lib/discover';
import { CONTROL_MARGIN } from '@/lib/ranking-controls';
import { VERDICT_LABELS } from '@/lib/report';
import { candidateUnverified } from '@/lib/unverified';

// The first thing on a ranking: who to look at first, how far to trust the list, and what the
// ranking gave the user that a follower count can't. Restated from the ranking below it.
export function RankingHeadline({ result }: { result: Discovery }) {
  const brand = result.brand.entity?.name || result.brand.name;
  const scored = result.candidates.filter((c) => c.status === 'scored');
  const top = scored[0];
  if (!top) return null;
  const topScore = top.compatibility.fitScore ?? 0;
  const joint = scored.filter((c) => topScore - (c.compatibility.fitScore ?? -Infinity) < CONTROL_MARGIN);
  const rankingUnverified = result.validation?.status === 'unverified';
  const topUnverified = (c: CreatorCandidate) => candidateUnverified(c, result).length > 0;

  let headline: string;
  let detail: string;
  if (rankingUnverified) {
    headline = 'Ranking unverified: don’t use it for a decision yet.';
    detail = result.validation?.reasons[0] ?? 'The win/lose controls didn’t hold for this run.';
  } else if (joint.length > 1) {
    headline = `Start with ${joint.map((c) => c.name).join(', ')}: joint first, within ${CONTROL_MARGIN} points (top Fit ${topScore}).`;
    detail = 'A gap that small isn’t a ranking: open each one, then check their videos before deciding.';
  } else {
    headline = `Start with ${top.name}: Fit ${topScore}, ${VERDICT_LABELS[top.compatibility.verdict].toLowerCase()}.`;
    detail = topUnverified(top)
      ? `${top.name}’s own score is unverified (see the ranking); check their videos before deciding.`
      : `Next: open ${top.name} for the tastes behind the score, then check their actual videos.`;
  }

  const tone = rankingUnverified ? 'border-rose-200 bg-rose-50 text-rose-950' : 'border-teal-200 bg-teal-50 text-teal-950';
  return (
    <section aria-label="Bottom line" className={`rounded-xl border p-4 sm:p-5 ${tone}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Bottom line</p>
      <p className="mt-1 text-lg font-semibold leading-snug">{headline}</p>
      <p className="mt-1 text-sm">{detail}</p>
      <p className="mt-1 text-sm opacity-80">
        {scored.length} of {result.candidates.length} YouTubers scored for {brand}.
      </p>
      <ul className="mt-4 grid gap-3 border-t border-current/10 pt-3 text-sm sm:grid-cols-3">
        <li>
          <p className="font-semibold">Taste evidence, not follower counts</p>
          <p className="mt-0.5 opacity-80">Each creator is scored on the brands, music, films, shows and places their audience likes, against {brand}’s audience in Qloo.</p>
        </li>
        <li>
          <p className="font-semibold">Every point is traceable</p>
          <p className="mt-0.5 opacity-80">Each creator’s page lists the Qloo entities behind the score; the Agent Trace lists every call.</p>
        </li>
        <li>
          <p className="font-semibold">A shortlist in under a minute</p>
          <p className="mt-0.5 opacity-80">Then analyze a shortlisted creator’s latest videos, from the link on their card, for direct evidence.</p>
        </li>
      </ul>
    </section>
  );
}
