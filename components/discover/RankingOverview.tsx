import { VERDICT_STYLE, cardId, extremes } from '@/components/discover/CandidateCard';
import type { CreatorCandidate } from '@/lib/discover';
import { VERDICT_LABELS } from '@/lib/report';

// The whole ranking on one screen; each name jumps to that creator's card below.
// An unverified ranking (lib/ranking-controls) shows no fit verdicts.
export function RankingOverview({ candidates, unverified = false }: { candidates: CreatorCandidate[]; unverified?: boolean }) {
  return (
    <section aria-label="Ranking at a glance" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
          <tr>
            <th scope="col" className="w-10 py-2 pl-4 pr-1 font-medium sm:w-12">
              #
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Creator
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Fit
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
              Verdict
            </th>
            <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
              Strongest
            </th>
            <th scope="col" className="hidden py-2 pl-3 pr-4 font-medium md:table-cell">
              Weakest
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {candidates.map((c) => {
            const { best, worst } = extremes(c);
            const scored = c.status === 'scored';
            return (
              <tr key={c.qlooId} className="transition-colors hover:bg-slate-50">
                <td className="py-2.5 pl-4 pr-1 tabular-nums text-slate-400">{c.rank}</td>
                <td className="px-2 py-2.5">
                  <a href={`#${cardId(c)}`} className="font-medium text-slate-900 hover:text-teal-700 hover:underline">
                    {c.name}
                  </a>
                </td>
                <td className="px-2 py-2.5 text-right text-base font-semibold tabular-nums text-slate-900">{c.compatibility.fitScore ?? '—'}</td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  {unverified && scored ? (
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-rose-800 ring-1 ring-rose-200">Unverified</span>
                  ) : scored ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${VERDICT_STYLE[c.compatibility.verdict]}`}>
                      {VERDICT_LABELS[c.compatibility.verdict]}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">No score</span>
                  )}
                </td>
                <td className="hidden px-3 py-2.5 text-slate-700 md:table-cell">
                  {best ? (
                    <>
                      {best.label} <span className="tabular-nums text-slate-500">{best.score}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="hidden py-2.5 pl-3 pr-4 text-slate-700 md:table-cell">
                  {worst ? (
                    <>
                      {worst.label} <span className="tabular-nums text-slate-500">{worst.score}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
