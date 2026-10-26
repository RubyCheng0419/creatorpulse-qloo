'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TasteComparison } from '@/components/match/TasteComparison';
import type { CreatorCandidate } from '@/lib/discover';
import { NO_DATA_NEXT_STEPS } from '@/lib/no-data';
import { VERDICT_LABELS } from '@/lib/report';
import type { ScoredEntity } from '@/lib/scoring';

const VERDICT_STYLE: Record<string, string> = {
  high: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  medium: 'bg-teal-50 text-teal-800 ring-teal-200',
  low: 'bg-amber-50 text-amber-800 ring-amber-200',
  'no-match': 'bg-rose-50 text-rose-800 ring-rose-200',
  'insufficient-data': 'bg-slate-100 text-slate-700 ring-slate-200',
};

const names = (list: ScoredEntity[]) => list.map((e) => `${e.name} ${e.brandAffinity.toFixed(2)}`).join(', ');

// One ranked creator: the score, what it rests on, and the way into the video deep dive.
export function CandidateCard({ c, deepDiveHref }: { c: CreatorCandidate; deepDiveHref: string | null }) {
  const [open, setOpen] = useState(false);
  const comp = c.compatibility;
  const dims = comp.dimensions.filter((d) => d.score !== null);
  const best = [...dims].sort((a, b) => b.score! - a.score!)[0];
  const worst = [...dims].sort((a, b) => a.score! - b.score!)[0];
  const all = comp.dimensions.flatMap((d) => [...d.intersection, ...d.weakLink, ...d.divergence]);
  const shared = all.filter((e) => comp.dimensions.some((d) => d.intersection.includes(e))).sort((a, b) => b.brandAffinity - a.brandAffinity).slice(0, 3);
  const clashes = all.filter((e) => comp.dimensions.some((d) => d.divergence.includes(e))).sort((a, b) => a.brandAffinity - b.brandAffinity).slice(0, 3);

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        <span className="text-2xl font-bold tabular-nums text-slate-300">#{c.rank}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-slate-900">{c.name}</h3>
          {c.description && <p className="text-sm text-slate-500">{c.description}</p>}
          <p className="mt-1 text-xs text-slate-500">
            Audience overlap {c.audienceOverlap !== null ? c.audienceOverlap.toFixed(2) : '—'} (how strongly the brand’s audience likes this
            creator) · {c.profile.scored} audience-taste entities scored
            {c.profile.unsupportedTypes?.length ? ` · Qloo has no audience-taste data for: ${c.profile.unsupportedTypes.join(', ')}` : ''}
            {c.profile.failedTypes.length ? ` · Qloo didn’t answer this time for: ${c.profile.failedTypes.join(', ')}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold tabular-nums leading-none text-slate-900">
            {comp.fitScore ?? '—'}
            {comp.fitScore !== null && <span className="text-base font-medium text-slate-400">/100</span>}
          </p>
          <p className="mt-1 text-xs text-slate-500">Fit Score · {comp.confidence ?? '—'} confidence</p>
        </div>
      </div>

      {c.status === 'scored' ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${VERDICT_STYLE[comp.verdict]}`}>{VERDICT_LABELS[comp.verdict]}</span>
            {best && (
              <span className="text-slate-600">
                Strongest: {best.label} {best.score}
              </span>
            )}
            {worst && worst !== best && (
              <span className="text-slate-600">
                · Weakest: {worst.label} {worst.score}
              </span>
            )}
          </div>
          <dl className="mt-2 space-y-0.5 text-sm">
            <div>
              <dt className="inline font-medium text-emerald-800">Shared taste: </dt>
              <dd className="inline text-slate-700">{shared.length ? names(shared) : 'none at affinity 0.85 or above'}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-rose-800">Clashes: </dt>
              <dd className="inline text-slate-700">{clashes.length ? names(clashes) : 'none'}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="mt-3 text-sm text-amber-800">
          No score: Qloo scored only {c.profile.scored} of this creator’s audience-taste entities.{' '}
          {c.noDataReason ? NO_DATA_NEXT_STEPS[c.noDataReason][0] : ''}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {c.status === 'scored' && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="font-medium text-teal-700 hover:underline">
            {open ? 'Hide evidence' : 'Show the evidence'}
          </button>
        )}
        {deepDiveHref ? (
          <Link href={deepDiveHref} className="font-medium text-teal-700 hover:underline">
            Analyze {c.channel!.handle}’s latest videos →
          </Link>
        ) : (
          <span className="text-xs text-slate-500">No YouTube channel matched this creator’s name, so there is no video deep dive.</span>
        )}
        {c.channel && (
          <a href={c.channel.url} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:underline">
            {c.channel.title} on YouTube ↗
          </a>
        )}
      </div>

      {open && (
        <div className="mt-3">
          <TasteComparison dimensions={comp.dimensions} proxyLabel="Audience taste in Qloo" title={`Why ${c.name} scores ${comp.fitScore}`} />
        </div>
      )}
    </li>
  );
}
