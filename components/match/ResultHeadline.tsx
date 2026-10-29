import type { Match } from '@/lib/match';
import { type DecisionSummary } from '@/lib/report';
import { isCounted } from '@/lib/scoring';

const TONE: Record<DecisionSummary['verdict'], string> = {
  Go: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  Conditional: 'border-teal-200 bg-teal-50 text-teal-950',
  Hold: 'border-amber-200 bg-amber-50 text-amber-950',
};

// The first thing on a result: the decision in one line, why, and what this check gave the user
// that a follower count can't. Everything here is restated from the Summary (lib/report
// decisionSummary) and the scores below it; nothing new is computed.
export function ResultHeadline({ match, decision }: { match: Match; decision: DecisionSummary | null }) {
  const brand = match.brand.entity?.name || match.brand.name;
  const creator = match.creator.channelName || 'this creator';

  if (!decision) {
    return (
      <section aria-label="Bottom line" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-900">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bottom line</p>
        <p className="mt-1 text-lg font-semibold">No score: Qloo has too little evidence for this pair.</p>
        <p className="mt-1 text-sm text-slate-700">
          CreatorPulse gives no score rather than one without evidence. What fell short, and what to try next, is below.
        </p>
      </section>
    );
  }

  const dims = match.compatibility.dimensions.filter(isCounted);
  const signals = dims.reduce((n, d) => n + d.intersection.length + d.weakLink.length + d.divergence.length, 0);
  const source = match.scoreBasis === 'audience' ? `${creator}’s audience likes` : `${creator}’s videos name or lead to`;

  return (
    <section aria-label="Bottom line" className={`rounded-lg border p-4 ${TONE[decision.verdict]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Bottom line</p>
      <p className="mt-1 text-lg font-semibold leading-snug">
        {decision.verdict}: {decision.condition}
      </p>
      <p className="mt-0.5 text-sm font-medium opacity-80">
        Fit {decision.fitScore}/100 · {decision.level} confidence
      </p>
      <p className="mt-2 text-sm leading-relaxed">{decision.why}</p>
      <p className="mt-2 text-sm leading-relaxed">
        <span className="font-semibold">Next step:</span> {decision.next}
      </p>

      <ul className="mt-4 grid gap-3 border-t border-current/10 pt-3 text-sm sm:grid-cols-3 print:grid-cols-3">
        <li>
          <p className="font-semibold">Taste evidence, not follower counts</p>
          <p className="mt-0.5 opacity-80">
            {signals} things {source}, each scored against {brand}’s audience in Qloo’s taste graph, across {dims.length} of 5 taste areas.
          </p>
        </li>
        <li>
          <p className="font-semibold">Every point is traceable</p>
          <p className="mt-0.5 opacity-80">The Qloo entities behind each taste area, and every API call in the Agent Trace, are listed below.</p>
        </li>
        <li>
          <p className="font-semibold">A decision, not just a number</p>
          <p className="mt-0.5 opacity-80">Go, Conditional or Hold, with the condition and a next step you can brief from.</p>
        </li>
      </ul>
    </section>
  );
}
