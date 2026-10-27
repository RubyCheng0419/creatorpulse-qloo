'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { DIVERGENCE_MAX, INTERSECTION_MIN, type Dimension, type DimensionScore, type ScoredEntity } from '@/lib/scoring';

const TYPE_LABELS: Record<string, string> = {
  'urn:entity:brand': 'brand',
  'urn:entity:artist': 'artist',
  'urn:entity:movie': 'movie',
  'urn:entity:tv_show': 'TV show',
  'urn:entity:book': 'book',
  'urn:entity:podcast': 'podcast',
  'urn:entity:videogame': 'video game',
  'urn:entity:destination': 'destination',
  'urn:entity:place': 'place',
  'urn:entity:person': 'person',
};

// What each dimension is made of, for the plain-language takeaway.
const DIMENSION_NOUNS: Record<Dimension, string> = {
  tech: 'tech brands and products',
  entertainment: 'films, shows and people',
  music: 'music and artists',
  lifestyle: 'lifestyle and fashion brands',
  food_travel: 'food, drink and travel spots',
};

const PRINT_LIMIT = 3;

// What the creator side is: what the videos cover (a match), or what the creator's
// audience likes in Qloo (Find creators, or a match scored from the creator's audience).
export type CreatorBasis = 'content' | 'audience';

// Two decimals, or more when rounding would carry an affinity across a tier boundary:
// 0.695 is a clash, and showing it as "0.70" under "< 0.70" reads like a bug.
export function formatAffinity(a: number): string {
  for (let digits = 2; digits < 4; digits++) {
    const s = a.toFixed(digits);
    if (![DIVERGENCE_MAX, INTERSECTION_MIN].some((t) => a < t && Number(s) >= t)) return s;
  }
  return (Math.floor(a * 1e4) / 1e4).toFixed(4); // truncated, so it can't round up across
}

// Qloo popularity is a 0–1 percentile: 0.9992 → "top 0.1%", 0.87 → "top 13%".
export function popularityLabel(p: number | null | undefined): string | null {
  if (typeof p !== 'number') return null;
  const top = (1 - p) * 100;
  return `top ${top < 0.1 ? '0.1' : top < 10 ? top.toFixed(1).replace(/\.0$/, '') : Math.round(top)}%`;
}

// Same thresholds as the verdict (lib/scoring.ts verdictOf), in words.
function feeling(score: number): string {
  if (score >= 80) return 'loves';
  if (score >= 60) return 'likes';
  if (score >= 40) return 'is lukewarm about';
  return 'isn’t into';
}

function takeaway(d: DimensionScore, audience: string, basis: CreatorBasis): string {
  const what = basis === 'audience' ? 'this creator’s audience likes' : 'this creator covers';
  const all = [...d.intersection, ...d.weakLink, ...d.divergence].sort((a, b) => b.brandAffinity - a.brandAffinity);
  const [top, bottom] = [all[0], all[all.length - 1]];
  const ends = all.length > 1 ? ` Highest: ${top.name} ${formatAffinity(top.brandAffinity)} · lowest: ${bottom.name} ${formatAffinity(bottom.brandAffinity)}.` : '';
  return `${audience} ${feeling(d.score!)} the ${DIMENSION_NOUNS[d.dimension]} ${what} (${d.score}/100).${ends}`;
}

function EntityRow({ e, basis, sources }: { e: ScoredEntity; basis: CreatorBasis; sources: boolean }) {
  const origin = e.side === 'direct' ? 'In the videos' : basis === 'audience' ? 'Audience taste' : 'Related by Qloo';
  const popularity = popularityLabel(e.popularity);
  return (
    <li className="py-2 text-sm print:py-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-medium text-slate-900">
          {e.name}
          <span className="ml-1.5 text-xs font-normal text-slate-500">
            {TYPE_LABELS[e.type] || e.type}
            {popularity && (
              <span title={`Qloo popularity ${e.popularity!.toFixed(3)} (0–1, from GET /entities or /v2/insights)`}>
                {' '}
                · {popularity} popularity
              </span>
            )}
          </span>
        </span>
        <span className="shrink-0 tabular-nums text-slate-700">{formatAffinity(e.brandAffinity)}</span>
      </div>
      <div className="mt-0.5 text-xs text-slate-500">
        <span className={`rounded px-1.5 py-px ${e.side === 'direct' ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-500'}`}>{origin}</span>
        {sources && (
          // Its own line on screen; inline in print, so the PDF keeps one line per entity.
          <span className="mt-1 block print:mt-0 print:ml-2 print:inline">
            {e.side === 'direct' ? `Named as “${e.query}”` : <span className="print:hidden">From {e.query}</span>}{' '}
            <span className="font-mono break-all">{e.id}</span>
          </span>
        )}
      </div>
    </li>
  );
}

function EntityList({
  title,
  hint,
  tone,
  items,
  empty,
  basis,
  sources,
}: {
  title: string;
  hint: string;
  tone: string;
  items: ScoredEntity[];
  empty: string;
  basis: CreatorBasis;
  sources: boolean;
}) {
  return (
    <div>
      <h4 className={`text-sm font-semibold ${tone}`}>
        {title} <span className="text-xs font-normal text-slate-500">{hint}</span>
      </h4>
      {items.length ? (
        <ul className="divide-y divide-slate-100">
          {items.map((e) => (
            <EntityRow key={e.id} e={e} basis={basis} sources={sources} />
          ))}
        </ul>
      ) : (
        <p className="py-2 text-sm text-slate-500">{empty}</p>
      )}
    </div>
  );
}

function Evidence({ d, basis, sources, limit }: { d: DimensionScore; basis: CreatorBasis; sources: boolean; limit?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3">
      <EntityList
        title="Loves these"
        hint={`affinity ≥ ${INTERSECTION_MIN}`}
        tone="text-teal-700"
        items={d.intersection.slice(0, limit)}
        empty="Nothing the audience loves here"
        basis={basis}
        sources={sources}
      />
      <EntityList
        title="Lukewarm"
        hint={`affinity ${DIVERGENCE_MAX.toFixed(2)}–${INTERSECTION_MIN}`}
        tone="text-amber-700"
        items={(d.weakLink ?? []).slice(0, limit)}
        empty="Nothing lukewarm"
        basis={basis}
        sources={sources}
      />
      <EntityList
        title="Not into these · clash"
        hint={`affinity < ${DIVERGENCE_MAX.toFixed(2)}`}
        tone="text-rose-700"
        items={d.divergence.slice(0, limit)}
        empty="No clash"
        basis={basis}
        sources={sources}
      />
    </div>
  );
}

export function TasteComparison({
  dimensions,
  brandName,
  basis = 'content',
  title = 'Five taste dimensions',
}: {
  dimensions: DimensionScore[];
  brandName?: string;
  basis?: CreatorBasis;
  title?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [sources, setSources] = useState(false);
  // "Huggies’ audience", not "Huggies’s".
  const audience = brandName ? `${brandName}${/s$/i.test(brandName) ? '’' : '’s'} audience` : 'The brand’s audience';
  const what = basis === 'audience' ? 'what this creator’s audience likes' : 'what this creator covers';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 print:p-4">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-3xl text-sm text-slate-600 print:hidden">
        How much {audience.replace(/^The/, 'the')} likes {what}, one area of taste at a time. Each score averages Qloo’s affinity for the
        things in that area: higher means the audience likes them more. Open an area to see what it is based on.
      </p>

      <ul className="mt-4 space-y-3">
        {dimensions.map((d) => {
          const isOpen = open === d.dimension;
          return (
            <li key={d.dimension} className="rounded-lg border border-slate-100 print:break-inside-avoid">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : d.dimension)}
                disabled={d.score === null}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 px-3 py-3 text-left enabled:hover:bg-slate-50 disabled:cursor-default sm:gap-4"
              >
                <span className="w-28 shrink-0 sm:w-44">
                  <span className="block text-sm leading-tight font-medium text-slate-800">{d.label}</span>
                  {d.score !== null && (
                    <span className="mt-0.5 block text-xs text-slate-500">
                      <span className="text-teal-700">{d.intersection.length} loved</span> ·{' '}
                      <span className="text-amber-700">{(d.weakLink ?? []).length} lukewarm</span> ·{' '}
                      <span className="text-rose-700">{d.divergence.length} clash</span>
                    </span>
                  )}
                </span>
                <span className="relative h-3 min-w-12 flex-1 overflow-hidden rounded-full bg-slate-100">
                  {d.score !== null && <span className="absolute inset-y-0 left-0 rounded-full bg-teal-600" style={{ width: `${d.score}%` }} />}
                </span>
                <span className="w-14 shrink-0 text-right text-sm tabular-nums text-slate-900 sm:w-20">
                  {d.score === null ? <span className="text-slate-500">No data</span> : d.score}
                </span>
                {d.score !== null && (
                  <ChevronDown aria-hidden className={`size-4 shrink-0 text-slate-400 transition-transform print:hidden ${isOpen ? 'rotate-180' : ''}`} />
                )}
                {d.score === null && <span className="w-4 shrink-0 print:hidden" />}
              </button>

              {d.score === null ? (
                <p className="px-3 pb-3 text-xs text-slate-500">No scorable Qloo data, so this dimension is excluded from the total. Missing data is not evidence of a clash.</p>
              ) : (
                <>
                  {isOpen && (
                    <div className="border-t border-slate-100 px-3 py-3 print:hidden">
                      <p className="text-sm font-medium text-slate-900">{takeaway(d, audience, basis)}</p>
                      <div className="mt-1 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>
                          Based on {d.itemCount} {d.itemCount === 1 ? 'thing' : 'things'} Qloo knows · {(d.weight * 100).toFixed(0)}% of the Fit Score
                        </span>
                        <button
                          type="button"
                          onClick={() => setSources(!sources)}
                          aria-pressed={sources}
                          className="font-medium text-teal-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                        >
                          {sources ? 'Hide Qloo IDs and sources' : 'Show Qloo IDs and sources'}
                        </button>
                      </div>
                      <Evidence d={d} basis={basis} sources={sources} />
                    </div>
                  )}
                  <div className="hidden border-t border-slate-100 px-3 py-2 print:block">
                    <Evidence d={d} basis={basis} sources limit={PRINT_LIMIT} />
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
