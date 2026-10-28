import Link from 'next/link';
import type { Match } from '@/lib/match';
import { VERDICT_LABELS } from '@/lib/report';
import { rankable } from '@/lib/scoring';
import { codesText, matchUnverified } from '@/lib/unverified';
import { VERDICT_STYLE } from '@/components/discover/CandidateCard';
import { formatAffinity } from '@/components/match/TasteComparison';

// Only dimensions that may be named strongest or weakest (lib/scoring rankable).
const dimText = (m: Match, pick: 'max' | 'min') => {
  const dims = rankable(m.compatibility.dimensions);
  if (!dims.length) return '—';
  const d = pick === 'max' ? dims[0] : dims[dims.length - 1];
  return `${d.label} ${d.score}`;
};

// One brand, several creators, side by side: a single score gets its reference points.
// Rows are sorted by Fit Score; a creator without a score stays in the table with its cause.
export function ComparisonTable({ matches, linkRows = true }: { matches: Match[]; linkRows?: boolean }) {
  const rows = [...matches].sort((a, b) => (b.compatibility.fitScore ?? -1) - (a.compatibility.fitScore ?? -1));
  const top = rows[0]?.compatibility.fitScore ?? null;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
          <tr>
            <th scope="col" className="py-2 pl-4 pr-2 font-medium">Creator</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Fit</th>
            <th scope="col" className="px-2 py-2 font-medium">Confidence</th>
            <th scope="col" className="px-2 py-2 font-medium">Strongest</th>
            <th scope="col" className="px-2 py-2 font-medium">Weakest</th>
            <th scope="col" className="py-2 pl-2 pr-4 font-medium">Clash</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 align-top">
          {rows.map((m) => {
            const c = m.compatibility;
            const clashes = c.dimensions.flatMap((d) => d.divergence).sort((a, b) => a.brandAffinity - b.brandAffinity);
            const name = m.creator.channelName || m.creator.youtubeHandle || 'Creator';
            const unverified = matchUnverified(m);
            return (
              <tr key={`${m.id}:${m.createdAt}`}>
                <td className="py-2.5 pl-4 pr-2">
                  {linkRows ? (
                    <Link href={`/match/${m.id}`} className="font-medium text-slate-900 hover:text-teal-700 hover:underline">
                      {name}
                    </Link>
                  ) : (
                    <span className="font-medium text-slate-900">{name}</span>
                  )}
                  <span className="block text-xs text-slate-500">
                    {m.scoreBasis === 'audience'
                      ? 'Scored from audience taste in Qloo'
                      : `${c.confidenceBasis?.entities ?? m.creator.entities.length} named entities scored`}
                    {m.cachedAt ? ' · cached' : ''}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right">
                  <span className="text-base font-semibold tabular-nums text-slate-900">{c.fitScore ?? '—'}</span>
                  {c.fitScore !== null && top !== null && c.fitScore < top && (
                    <span className="block text-xs tabular-nums text-slate-500">{c.fitScore - top}</span>
                  )}
                </td>
                <td className="px-2 py-2.5">
                  {c.confidence ?? '—'}
                  {c.fitScore !== null && unverified.length ? (
                    <span
                      title={unverified.map((r) => `${r.code} · ${r.label}: ${r.detail}`).join('\n')}
                      className="mt-1 block w-fit rounded-full px-2 py-0.5 text-xs font-semibold text-rose-800 ring-1 ring-rose-200"
                    >
                      Unverified ({codesText(unverified)})
                    </span>
                  ) : c.fitScore !== null ? (
                    <span className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${VERDICT_STYLE[c.verdict]}`}>
                      {VERDICT_LABELS[c.verdict]}
                    </span>
                  ) : (
                    <span className="block text-xs text-slate-500">{m.errorMessage ? 'No score' : ''}</span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-slate-700">{dimText(m, 'max')}</td>
                <td className="px-2 py-2.5 text-slate-700">{dimText(m, 'min')}</td>
                <td className="py-2.5 pl-2 pr-4 text-slate-700">
                  {c.fitScore === null ? (
                    '—'
                  ) : clashes.length ? (
                    <>
                      <span className="font-medium text-rose-800">{clashes.length}</span>: {clashes[0].name} {formatAffinity(clashes[0].brandAffinity)}
                      {clashes.length > 1 ? '…' : ''}
                    </>
                  ) : (
                    'none'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
