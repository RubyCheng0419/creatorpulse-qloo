import type { Match } from '@/lib/match';
import { VERDICT_LABELS } from '@/lib/report';
import type { Verdict } from '@/lib/scoring';

const VERDICT_STYLE: Record<Verdict, string> = {
  high: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  medium: 'bg-teal-50 text-teal-800 ring-teal-200',
  low: 'bg-amber-50 text-amber-800 ring-amber-200',
  'no-match': 'bg-rose-50 text-rose-800 ring-rose-200',
  'insufficient-data': 'bg-slate-100 text-slate-700 ring-slate-200',
};

const VERDICT_HINT: Record<Verdict, string> = {
  high: 'Recommended. Focus on content direction.',
  medium: 'Workable. Steer clear of the conflicting dimensions.',
  low: 'Not recommended unless only one dimension matters.',
  'no-match': 'Not recommended.',
  'insufficient-data': 'Not enough Qloo evidence to score.',
};

export function ScoreCard({ match }: { match: Match }) {
  const c = match.compatibility;
  const brand = match.brand.entity?.name || match.brand.name;
  const creator = match.creator.channelName || 'this creator';
  const lowConfidence = c.confidence !== null && c.confidence < 60;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 print:break-inside-avoid print:p-4">
      {match.cachedAt && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          Cached result from {new Date(match.cachedAt).toLocaleString('en-US')}: the live analysis could not complete, so this is the last real analysis of the demo pair.
        </p>
      )}
      <p className="text-sm text-slate-500">Cultural compatibility due diligence</p>
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
        </div>
        <div>
          <p className="text-xs tracking-wide text-slate-500">Confidence</p>
          <p className="text-3xl font-semibold tabular-nums text-slate-900">{c.confidence ?? '—'}</p>
        </div>
        <div className="space-y-1">
          <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ring-1 ${VERDICT_STYLE[c.verdict]}`}>
            {VERDICT_LABELS[c.verdict]}
          </span>
          <p className="text-sm text-slate-600">{VERDICT_HINT[c.verdict]}</p>
        </div>
      </div>

      {lowConfidence && <p className="mt-4 text-sm font-medium text-amber-800">Low confidence: indicative only.</p>}
      <p className="mt-4 text-xs text-slate-500">
        {new Date(match.createdAt).toLocaleDateString('en-US')} · Report {match.id}
      </p>
    </section>
  );
}
