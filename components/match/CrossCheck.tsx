import type { Match } from '@/lib/match';

// GET /v2/analysis/compare, shown beside the Fit Score as a second, independent opinion:
// Qloo compares the two sides' tags. It carries no affinity and never feeds the score.
export function CrossCheck({ match }: { match: Match }) {
  const c = match.crossCheck;
  const brand = match.brand.entity?.name || match.brand.name;
  if (!c) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 print:hidden">
      <h3 className="text-base font-semibold text-slate-900">Cross-check: Qloo tag comparison</h3>
      {'skipped' in c ? (
        <p className="mt-1 text-sm text-slate-600">Not run: {c.skipped}</p>
      ) : (
        <>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            A second opinion from Qloo’s <code className="text-xs">GET /v2/analysis/compare</code>: the tags of {c.brandEntities.join(', ')} next to
            those of the creator’s {c.creatorEntities.length} confirmed entities. It uses no affinity and doesn’t change the Fit Score.
          </p>
          <p className="mt-3 text-sm font-medium text-slate-900">
            {c.shared.length
              ? `Both sides share ${c.shared.length} Qloo tag${c.shared.length === 1 ? '' : 's'}.`
              : `No shared tags: Qloo files ${brand} and this creator’s entities under different categories.`}
          </p>
          {c.shared.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {c.shared.map((t) => (
                <li key={t.id} className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs text-teal-900 ring-1 ring-teal-200" title={t.id}>
                  {t.name} <span className="tabular-nums text-teal-700">{t.score.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <TagList title={`${brand}’s tags`} tags={c.brandTags} />
            <TagList title="The creator’s tags" tags={c.creatorTags} />
          </div>
        </>
      )}
      {match.expansion && (
        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
          How “Related by Qloo” entities were gathered: Qloo popularity ≥ {match.expansion.popularityMin} (
          <code>filter.popularity.min</code>)
          {match.expansion.excludesBrand ? (
            <>
              , the brand side itself left out (<code>filter.exclude.entities</code>)
            </>
          ) : null}
          , and each one’s strongest contributors from <code>feature.explainability</code>. Scoring itself applies no popularity filter.
        </p>
      )}
    </section>
  );
}

function TagList({ title, tags }: { title: string; tags: { id: string; name: string; count: number }[] }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-slate-700">{title}</h4>
      {tags.length ? (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700" title={t.id}>
              {t.name}
              {t.count > 1 && <span className="text-slate-500"> ×{t.count}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-slate-500">None returned</p>
      )}
    </div>
  );
}
