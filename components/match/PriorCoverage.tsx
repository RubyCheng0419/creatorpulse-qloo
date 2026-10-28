import type { Match } from '@/lib/match';
import { TIER_DEFINITION, type CoveragePlace } from '@/lib/prior-coverage';

// Prior coverage: does the creator already mention the brand in the videos read? A tier, not a
// 0–100 number, so it can't be read as a second Fit Score; sourced from YouTube, not Qloo.
const TIER_STYLE = {
  High: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  Medium: 'bg-sky-100 text-sky-900 ring-sky-300',
  None: 'bg-slate-100 text-slate-700 ring-slate-300',
} as const;

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'date unknown');
const places = (p: CoveragePlace[]) => p.join(', ');

export function PriorCoverage({ match }: { match: Match }) {
  const brand = match.brand.entity?.name || match.brand.name;
  const c = match.priorCoverage;
  const n = c?.videosRead ?? match.creator.videos.length;
  const sample = `Based on these ${n} video${n === 1 ? '' : 's'} only, not the creator’s full channel history.`;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 print:break-inside-avoid" aria-labelledby="prior-coverage">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="prior-coverage" className="text-base font-semibold text-slate-900">
          Prior coverage of {brand}
        </h3>
        <p className="text-xs text-slate-500">Source: YouTube titles, descriptions and tags · not Qloo · not part of the Fit Score</p>
      </div>
      {!c ? (
        <p className="mt-2 text-sm text-slate-600">Not available for this result: it was saved before Prior coverage was added. Run it again to see it.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ring-1 ${TIER_STYLE[c.tier]}`}>{c.tier}</span>
            <p className="text-sm text-slate-800">
              {c.mentioning.length ? (
                <>
                  <span className="font-semibold">
                    {c.mentioning.length} / {n} videos
                  </span>{' '}
                  mention {brand}
                  {c.latest ? ` · latest ${date(c.latest)}` : ''}
                </>
              ) : (
                <span className="font-semibold">No mention in these {n} videos</span>
              )}
            </p>
          </div>
          {c.mentioning.length > 0 && (
            <p className="mt-2 text-sm text-slate-600">
              Brand name in {c.mentioning.filter((m) => m.brandPlaces.length).length} · product names in{' '}
              {c.mentioning.filter((m) => m.productPlaces.length).length}
              {c.productTerms.length ? ` (searched: ${c.productTerms.join(', ')})` : ' (no product names starting with the brand name were found)'}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Tier, CreatorPulse’s own definition: {TIER_DEFINITION} A mention is not an endorsement and says nothing about whether the creator
            likes {brand}.
          </p>
          {c.mentioning.length > 0 && (
            <ul className="mt-4 space-y-3">
              {c.mentioning.map((m) => (
                <li key={m.videoId} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <a href={m.url} target="_blank" rel="noreferrer" className="font-medium text-slate-900 underline-offset-2 hover:underline">
                    {m.title}
                  </a>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {date(m.publishedAt)}
                    {m.viewCount !== null ? ` · ${m.viewCount.toLocaleString('en-US')} views` : ' · views hidden'}
                  </p>
                  <p className="mt-1 text-xs text-slate-700">
                    {m.brandPlaces.length ? `Brand name in: ${places(m.brandPlaces)}` : ''}
                    {m.brandPlaces.length && m.productPlaces.length ? ' · ' : ''}
                    {m.productPlaces.length ? `Product names in: ${places(m.productPlaces)} (${m.products.join(', ')})` : ''}
                  </p>
                  <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-xs text-slate-600">
                    <span className="font-medium">{m.snippet.place}:</span> “{m.snippet.text}”
                  </blockquote>
                  {m.sponsorWords && (
                    <p className="mt-1 text-xs text-slate-600">
                      The description contains the word “{m.sponsorWords.word}”: “{m.sponsorWords.text}”. Quoted as written; not checked
                      against this brand.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-3 text-xs text-slate-500">{sample}</p>
    </section>
  );
}
