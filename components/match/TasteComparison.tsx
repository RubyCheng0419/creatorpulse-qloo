'use client';

import { createContext, useContext, useState } from 'react';
import { DIVERGENCE_MAX, INTERSECTION_MIN, type DimensionScore, type ScoredEntity } from '@/lib/scoring';

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

const PRINT_LIMIT = 3;

// What a one-step-removed entity is called: a match's cross-domain expansion, or a
// creator's audience taste in Find creators.
const ProxyLabel = createContext('Cross-domain expansion');

function EntityRow({ e }: { e: ScoredEntity }) {
  const proxyLabel = useContext(ProxyLabel);
  return (
    <li className="py-2 text-sm print:py-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium text-slate-900">
          {e.name}
          <span className="ml-2 text-xs font-normal text-slate-500">{TYPE_LABELS[e.type] || e.type}</span>
        </span>
        <span className="tabular-nums text-slate-700">affinity {e.brandAffinity.toFixed(2)}</span>
      </div>
      <div className="mt-0.5 text-xs text-slate-500">
        {e.side === 'direct' ? (
          `Named in the videos (“${e.query}”)`
        ) : (
          <>
            {proxyLabel}<span className="print:hidden"> (from {e.query})</span>
          </>
        )}
        <span className="ml-2 font-mono break-all">{e.id}</span>
      </div>
    </li>
  );
}

function EntityList({ title, tone, items, empty }: { title: string; tone: string; items: ScoredEntity[]; empty: string }) {
  return (
    <div>
      <h4 className={`text-xs font-semibold tracking-wide ${tone}`}>{title}</h4>
      {items.length ? (
        <ul className="divide-y divide-slate-100">
          {items.map((e) => (
            <EntityRow key={e.id} e={e} />
          ))}
        </ul>
      ) : (
        <p className="py-2 text-sm text-slate-500">{empty}</p>
      )}
    </div>
  );
}

function Evidence({ d, limit }: { d: DimensionScore; limit?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3 print:grid-cols-3">
      <EntityList
        title={`Shared taste (≥ ${INTERSECTION_MIN})`}
        tone="text-teal-700"
        items={d.intersection.slice(0, limit)}
        empty="No strongly related entities"
      />
      <EntityList
        title={`Weak link (${DIVERGENCE_MAX}–${INTERSECTION_MIN})`}
        tone="text-amber-700"
        items={(d.weakLink ?? []).slice(0, limit)}
        empty="No weak links"
      />
      <EntityList
        title={`Clash (< ${DIVERGENCE_MAX})`}
        tone="text-rose-700"
        items={d.divergence.slice(0, limit)}
        empty="No evidence of a clash"
      />
    </div>
  );
}

export function TasteComparison({
  dimensions,
  proxyLabel = 'Cross-domain expansion',
  title = 'Five taste dimensions',
}: {
  dimensions: DimensionScore[];
  proxyLabel?: string;
  title?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ProxyLabel.Provider value={proxyLabel}>
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 print:p-4">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500 print:hidden">Open a dimension to see the Qloo entities and IDs behind its score.</p>

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
                      <span className="text-teal-700">{d.intersection.length} shared</span> ·{' '}
                      <span className="text-amber-700">{(d.weakLink ?? []).length} weak</span> ·{' '}
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
                <span className="w-4 shrink-0 text-slate-400 print:hidden">{d.score === null ? '' : isOpen ? '−' : '+'}</span>
              </button>

              {d.score === null ? (
                <p className="px-3 pb-3 text-xs text-slate-500">No scorable Qloo data, so this dimension is excluded from the total. Missing data is not evidence of a clash.</p>
              ) : (
                <>
                  {isOpen && (
                    <div className="border-t border-slate-100 px-3 py-3 print:hidden">
                      <p className="mb-2 text-xs text-slate-500">
                        {d.itemCount} entities scored · weight {(d.weight * 100).toFixed(0)}%
                      </p>
                      <Evidence d={d} />
                    </div>
                  )}
                  <div className="hidden border-t border-slate-100 px-3 py-2 print:block">
                    <Evidence d={d} limit={PRINT_LIMIT} />
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
      </section>
    </ProxyLabel.Provider>
  );
}
