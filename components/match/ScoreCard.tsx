import Link from 'next/link';
import type { Match } from '@/lib/match';
import { VERDICT_LABELS, brandBasisNote } from '@/lib/report';
import type { Compatibility, Verdict } from '@/lib/scoring';
import { ScoreRange } from './ScoreRange';

const VERDICT_STYLE: Record<Verdict, string> = {
  high: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  medium: 'bg-teal-50 text-teal-800 ring-teal-200',
  low: 'bg-amber-50 text-amber-800 ring-amber-200',
  'no-match': 'bg-rose-50 text-rose-800 ring-rose-200',
  'insufficient-data': 'bg-slate-100 text-slate-700 ring-slate-200',
};

// The hint follows the evidence: it only mentions clashes when some dimension has one.
function verdictHint(c: Compatibility): string {
  const clashes = c.dimensions.filter((d) => d.score !== null && d.divergence.length).map((d) => d.label);
  const list = clashes.join(', ');
  switch (c.verdict) {
    case 'high':
      return clashes.length ? `Recommended. Watch for clashes in ${list}.` : 'Recommended. No evidence of a taste clash.';
    case 'medium':
      return clashes.length ? `Workable, but steer clear of ${list}.` : 'Workable. No evidence of a taste clash; the overlap is moderate.';
    case 'low':
      return 'Not recommended unless only one dimension matters.';
    case 'no-match':
      return 'Not recommended.';
    default:
      return 'Not enough Qloo evidence to score.';
  }
}

export function ScoreCard({ match }: { match: Match }) {
  const c = match.compatibility;
  const brand = match.brand.entity?.name || match.brand.name;
  const creator = match.creator.channelName || 'this creator';
  // Results saved before confidence became a level carry a number; don't show it.
  const level = typeof c.confidence === 'string' ? c.confidence : null;
  const lowConfidence = level === 'Low';
  const basisNote = brandBasisNote(match.brand);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 print:break-inside-avoid print:p-4">
      {match.cachedAt &&
        (match.cachedReason === 'fallback' ? (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
            <span className="font-semibold">Cached</span> result from {new Date(match.cachedAt).toLocaleString('en-US')}: the live run could not complete, so
            this is the last real analysis of the demo pair.
          </p>
        ) : (
          <p className="mb-4 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-950 ring-1 ring-sky-200">
            <span className="font-semibold">Cached</span> demo result: a real run of the full pipeline from {new Date(match.cachedAt).toLocaleString('en-US')},
            saved so the demo spends no API quota. Use <span className="font-medium">Run live</span> in the Agent Trace below to run it again now.
          </p>
        ))}
      {!match.cachedAt && (
        <p className="mb-4 text-xs font-medium text-teal-800">
          <span className="rounded bg-teal-50 px-1.5 py-0.5 ring-1 ring-teal-200">{match.liveRun ? 'Live run' : 'Live'}</span>{' '}
          {match.liveRun ? 'Every cache bypassed for this run.' : 'Analysed for this request (repeat calls may reuse cached API answers; see the Agent Trace).'}
        </p>
      )}
      {basisNote && (
        <p className="mb-4 rounded-md bg-violet-50 px-3 py-2 text-sm font-medium text-violet-900 ring-1 ring-violet-200">
          {basisNote} <span className="font-normal">Confidence is one level lower than the evidence alone would give.</span>
        </p>
      )}
      {match.scoreBasis === 'audience' && match.creator.qlooPerson && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <span className="font-semibold">Scored from {match.creator.qlooPerson.name}’s audience taste in Qloo.</span> The videos named only{' '}
          {match.creator.entities.length} Qloo {match.creator.entities.length === 1 ? 'entity' : 'entities'}, fewer than 3, so this score
          rests on what Qloo infers the creator’s audience likes, not on what the videos say. Confidence is at most Medium.
        </p>
      )}
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm text-slate-500">
        Cultural compatibility due diligence
        <Link href="/how-it-works" className="font-medium text-teal-700 hover:underline print:hidden">
          How the score works
        </Link>
      </p>
      <h2 className="mt-1 text-xl font-semibold text-slate-900">
        {brand} × {creator}
        {match.creator.youtubeHandle && <span className="ml-2 text-base font-normal text-slate-500">{match.creator.youtubeHandle}</span>}
      </h2>

      <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <p className="text-xs tracking-wide text-slate-500">Fit Score</p>
          <p className="text-6xl font-bold tabular-nums leading-none text-slate-900">
            {c.fitScore ?? '—'}
            {c.fitScore !== null && <span className="text-2xl font-medium text-slate-400">/100</span>}
          </p>
          <ScoreRange match={match} />
        </div>
        <div>
          <p className="text-xs tracking-wide text-slate-500">Confidence</p>
          <p className="text-3xl font-semibold text-slate-900">{level ?? '—'}</p>
          {c.confidenceBasis && 'entities' in c.confidenceBasis && (
            <p className="max-w-48 text-xs text-slate-500">
              Confidence based on {c.confidenceBasis.entities} confirmed entities across {c.confidenceBasis.dimensions} dimensions
            </p>
          )}
        </div>
        <div className="space-y-1">
          <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ring-1 ${VERDICT_STYLE[c.verdict]}`}>
            {VERDICT_LABELS[c.verdict]}
          </span>
          <p className="text-sm text-slate-600">{verdictHint(c)}</p>
        </div>
      </div>

      {match.mentionsBrand && (
        <p className="mt-4 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-sky-200">
          <span className="font-semibold">The creator already features {brand} in these videos.</span> That mention is not part of the
          score, because a brand can’t be scored against itself. The Fit Score measures how {brand}’s audience relates to everything else
          the creator covers.
        </p>
      )}
      {match.creator.qlooPerson && typeof match.creator.audienceOverlap === 'number' && (
        <p className="mt-4 text-sm text-slate-600">
          <span className="font-medium text-slate-800">Audience overlap {match.creator.audienceOverlap.toFixed(2)}</span>: how strongly{' '}
          {brand}’s audience likes {match.creator.qlooPerson.name} in Qloo. Shown, not part of the score.
        </p>
      )}
      {lowConfidence && <p className="mt-4 text-sm font-medium text-amber-800">Low confidence: indicative only.</p>}
      <p className="mt-4 text-xs text-slate-500">
        {new Date(match.createdAt).toLocaleDateString('en-US')} · Report {match.id}
      </p>
    </section>
  );
}
