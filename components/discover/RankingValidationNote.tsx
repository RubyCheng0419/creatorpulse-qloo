import type { RankingValidation } from '@/lib/ranking-controls';

const TONE: Record<RankingValidation['status'], { box: string; title: string }> = {
  validated: { box: 'border-teal-200 bg-teal-50 text-teal-950', title: 'Validated against win/lose controls' },
  unverified: { box: 'border-rose-300 bg-rose-50 text-rose-950', title: 'Unverified — do not use for a decision' },
  'not-validated': { box: 'border-slate-200 bg-slate-50 text-slate-800', title: 'Not validated for this brand' },
};

// Shown above a ranking: whether the controls held, what they scored, and whether one dimension
// drags every creator down. An unverified ranking loses its fit verdicts (see CandidateCard).
export function RankingValidationNote({ v }: { v: RankingValidation }) {
  const tone = TONE[v.status];
  return (
    <section aria-label="Ranking validation" className={`rounded-xl border p-4 text-sm ${tone.box}`}>
      <h3 className="font-semibold">{tone.title}</h3>
      {v.status === 'not-validated' && !v.controls.length ? (
        <p className="mt-1">
          Win/lose controls exist only for the demo brands (Apple, Huggies, Le Labo Fragrances) with Any YouTuber. Treat this ranking as indicative.
        </p>
      ) : (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {v.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {v.controls.length > 0 && (
        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {v.controls.map((c) => (
            <div key={c.role}>
              <dt className="text-xs font-semibold uppercase tracking-wide opacity-70">Obvious {c.role}</dt>
              <dd>
                <span className="font-medium">{c.name}</span> {c.fitScore ?? 'no score'}
                {c.rank ? ` (ranked #${c.rank})` : ' (not in the ranking)'}
                {c.strongest && (
                  <span className="block text-xs opacity-80">
                    Strongest {c.strongest} · weakest {c.weakest}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {v.weakest && (
        <p className="mt-3 border-t border-current/10 pt-2 text-xs opacity-90">
          {v.weakest.label} is the weakest dimension for {v.weakest.count} of {v.weakest.of} creators.{' '}
          {v.weakest.top3.join() === v.weakest.top3Without.join()
            ? 'Leaving it out keeps the same top 3, so it doesn’t decide the ranking.'
            : `Leaving it out changes the top 3 to ${v.weakest.top3Without.join(', ')}.`}
        </p>
      )}
    </section>
  );
}
