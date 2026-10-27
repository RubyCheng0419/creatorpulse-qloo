'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown, ExternalLink } from 'lucide-react';
import { TasteComparison, formatAffinity } from '@/components/match/TasteComparison';
import type { CreatorCandidate } from '@/lib/discover';
import { NO_DATA_NEXT_STEPS } from '@/lib/no-data';
import { VERDICT_LABELS } from '@/lib/report';
import type { ScoredEntity } from '@/lib/scoring';

export const VERDICT_STYLE: Record<string, string> = {
  high: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  medium: 'bg-teal-50 text-teal-800 ring-teal-200',
  low: 'bg-amber-50 text-amber-800 ring-amber-200',
  'no-match': 'bg-rose-50 text-rose-800 ring-rose-200',
  'insufficient-data': 'bg-slate-100 text-slate-700 ring-slate-200',
};

const names = (list: ScoredEntity[]) => list.map((e) => `${e.name} ${formatAffinity(e.brandAffinity)}`).join(', ');

// The strongest and weakest of the dimensions that have data; shared by the card and the overview.
export function extremes(c: CreatorCandidate) {
  const dims = c.compatibility.dimensions.filter((d) => d.score !== null);
  const best = [...dims].sort((a, b) => b.score! - a.score!)[0];
  const worst = [...dims].sort((a, b) => a.score! - b.score!)[0];
  return { best, worst: worst !== best ? worst : undefined };
}

export const cardId = (c: CreatorCandidate) => `creator-${c.rank}`;

// One ranked creator: the score, what it rests on, and the way into the video deep dive.
// The main identity Qloo's description gives a creator, and the dimension that identity
// should be strong in. Only words Qloo itself wrote are matched; no match, no check.
const IDENTITY_DIMENSION: [RegExp, string][] = [
  [/\b(singer|musician|rapper|songwriter|dj|band|composer)\b/i, 'Music'],
  [/\b(actor|actress|comedian|filmmaker|film|television|tv)\b/i, 'Film, TV & Entertainment'],
  [/\b(make-up|makeup|beauty|fashion|model|stylist)\b/i, 'Lifestyle & Fashion'],
  [/\b(chef|cook|food|travel|traveller|traveler)\b/i, 'Food & Travel'],
  [/\b(technology|tech)\b/i, 'Tech & Innovation'],
];

// What a reviewer needs to tell what the score rests on: the entities behind the strongest
// dimension, how much was scored, thin dimensions that still weigh a full share, and a main
// identity whose dimension isn't strong.
function EvidenceSummary({ c }: { c: CreatorCandidate }) {
  const dims = c.compatibility.dimensions;
  const withData = dims.filter((d) => d.score !== null).sort((a, b) => b.score! - a.score!);
  const best = withData[0];
  const drivers = best ? [...best.intersection, ...best.weakLink, ...best.divergence].sort((a, b) => b.brandAffinity - a.brandAffinity).slice(0, 3) : [];
  const thin = withData.filter((d) => d.itemCount < 3);
  const empty = dims.filter((d) => d.score === null);
  const identity = c.description ? IDENTITY_DIMENSION.find(([re]) => re.test(c.description!)) : undefined;
  const idDim = identity ? dims.find((d) => d.label === identity[1]) : undefined;
  const idRank = idDim ? withData.indexOf(idDim) + 1 : 0;
  const word = identity && c.description ? c.description.match(identity[0])?.[0] : null;
  return (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
      <li>
        {c.profile.scored} audience-taste entities scored, across {withData.length} of {dims.length} dimensions
        {empty.length ? ` (no data: ${empty.map((d) => d.label).join(', ')}; excluded, not counted as zero)` : ''}. All are Qloo’s audience taste for{' '}
        {c.name}; none were named in videos.
      </li>
      {best && (
        <li>
          Strongest, {best.label} {best.score}, comes from {drivers.map((e) => `${e.name} ${formatAffinity(e.brandAffinity)}`).join(', ')}
          {best.itemCount > drivers.length ? ` and ${best.itemCount - drivers.length} more` : ''}.
        </li>
      )}
      {thin.map((d) => (
        <li key={d.dimension} className="text-amber-800">
          {d.label} rests on {d.itemCount} entit{d.itemCount === 1 ? 'y' : 'ies'} ({d.score}) yet counts for {Math.round(d.weight * 100)}% of the Fit Score.
        </li>
      ))}
      {idDim && word && idRank !== 1 && (
        <li className="text-amber-800">
          Qloo describes {c.name} as “{word}”, but {idDim.label} is {idDim.score === null ? 'without data' : `${idDim.score}, #${idRank} of ${withData.length}`}: the
          score isn’t driven by that identity.
        </li>
      )}
    </ul>
  );
}

export function CandidateCard({
  c,
  deepDiveHref,
  brandName,
  unverified = false,
}: {
  c: CreatorCandidate;
  deepDiveHref: string | null;
  brandName?: string;
  unverified?: boolean; // the ranking failed its controls: no fit verdict
}) {
  const [open, setOpen] = useState(false);
  // Qloo's description lists every role ("singer, actor and YouTuber"): the person-level
  // profile then mixes the audiences of all of them.
  const roles = c.description ? c.description.split(/,|\band\b/).filter((s) => s.trim()).length : 0;
  const comp = c.compatibility;
  const { best, worst } = extremes(c);
  const all = comp.dimensions.flatMap((d) => [...d.intersection, ...d.weakLink, ...d.divergence]);
  const shared = all.filter((e) => comp.dimensions.some((d) => d.intersection.includes(e))).sort((a, b) => b.brandAffinity - a.brandAffinity).slice(0, 3);
  const clashes = all.filter((e) => comp.dimensions.some((d) => d.divergence.includes(e))).sort((a, b) => a.brandAffinity - b.brandAffinity).slice(0, 3);
  const scored = c.status === 'scored';
  const taste =
    `Audience overlap ${c.audienceOverlap !== null ? c.audienceOverlap.toFixed(2) : '—'} · ${c.profile.scored} audience-taste entities scored` +
    (c.profile.unsupportedTypes?.length ? ` · Qloo has no audience-taste data for: ${c.profile.unsupportedTypes.join(', ')}` : '') +
    (c.profile.failedTypes.length ? ` · Qloo didn’t answer this time for: ${c.profile.failedTypes.join(', ')}` : '');

  return (
    <li id={cardId(c)} className="scroll-mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3 sm:gap-4">
        <span className="w-8 shrink-0 pt-0.5 text-lg font-semibold tabular-nums text-slate-400 sm:w-10 sm:text-xl">#{c.rank}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold leading-snug text-slate-900">{c.name}</h3>
          {c.description && <p className="text-sm text-slate-500">{c.description}</p>}
          <p className="mt-1 hidden text-xs tabular-nums text-slate-500 sm:block">{taste}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-3xl font-bold tabular-nums leading-none text-slate-900 sm:text-4xl">
            {comp.fitScore ?? '—'}
            {comp.fitScore !== null && <span className="text-sm font-medium text-slate-400 sm:text-base">/100</span>}
          </p>
          {scored &&
            (unverified ? (
              <span className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold text-rose-800 ring-1 ring-rose-200">Unverified</span>
            ) : (
              <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${VERDICT_STYLE[comp.verdict]}`}>
                {VERDICT_LABELS[comp.verdict]}
              </span>
            ))}
          <p className="mt-1 text-xs text-slate-500">{comp.confidence ?? '—'} confidence</p>
        </div>
      </div>
      {/* On a phone it goes full width under the header row, so the score doesn't squeeze it. */}
      <p className="mt-2 text-xs tabular-nums text-slate-500 sm:hidden">{taste}</p>

      <dl className="mt-4 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr] sm:gap-y-1.5 sm:pl-14">
        <dt className="text-slate-500">Scored profile</dt>
        <dd className="mb-1 text-slate-800 sm:mb-0">
          Qloo person (person-level: all of {c.name} in Qloo, not one channel)
          {roles > 1 && <span className="block text-xs text-amber-800">Qloo lists several roles, so the profile mixes their audiences.</span>}
        </dd>
        <dt className="text-slate-500">YouTube channel</dt>
        <dd className="mb-1 text-slate-800 sm:mb-0">
          {c.channel ? (
            <>
              <a href={c.channel.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline">
                {c.channel.handle}
                <ExternalLink aria-hidden className="size-3" />
              </a>{' '}
              <span className="text-xs text-slate-500">({c.channel.title}; used only for the video deep dive, not in this score)</span>
            </>
          ) : (
            <span className="text-slate-500">None matched this name</span>
          )}
        </dd>
      </dl>
      {scored ? (
        <dl className="mt-1 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr] sm:gap-y-1.5 sm:pl-14">
          {best && (
            <>
              <dt className="text-slate-500">Strongest</dt>
              <dd className="mb-1 text-slate-800 sm:mb-0">
                {best.label} <span className="tabular-nums">{best.score}</span>
                {worst && (
                  <span className="text-slate-500">
                    {' '}
                    · weakest: {worst.label} <span className="tabular-nums">{worst.score}</span>
                  </span>
                )}
              </dd>
            </>
          )}
          <dt className="font-medium text-emerald-800">Shared taste</dt>
          <dd className="mb-1 text-slate-700 sm:mb-0">{shared.length ? names(shared) : 'none at affinity 0.85 or above'}</dd>
          <dt className="font-medium text-rose-800">Clashes</dt>
          <dd className="text-slate-700">{clashes.length ? names(clashes) : 'none'}</dd>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-amber-800 sm:pl-14">
          No score: Qloo scored only {c.profile.scored} of this creator’s audience-taste entities.{' '}
          {c.noDataReason ? NO_DATA_NEXT_STEPS[c.noDataReason][0] : ''}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm sm:pl-14">
        {scored && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-800 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            {open ? 'Hide the evidence' : 'Show the evidence'}
            <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
        {deepDiveHref ? (
          <Link href={deepDiveHref} className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline">
            Analyze {c.channel!.handle}’s latest videos
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        ) : (
          <span className="text-xs text-slate-500">No video deep dive without a matched channel.</span>
        )}
      </div>

      {open && (
        <div className="mt-3">
          <EvidenceSummary c={c} />
          <TasteComparison dimensions={comp.dimensions} brandName={brandName} basis="audience" title={`Why ${c.name} scores ${comp.fitScore}`} />
        </div>
      )}
    </li>
  );
}
