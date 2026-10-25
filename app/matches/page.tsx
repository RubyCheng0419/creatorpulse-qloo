'use client';

import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { useMatches } from '@/lib/history';
import { VERDICT_LABELS } from '@/lib/report';

// PRODUCT_SPEC v3.1 §2 P1: list, reopen and re-export only. No search, filters or re-scoring.

export default function MatchesPage() {
  const matches = useMatches();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-900">History</h1>
        <p className="mt-1 text-sm text-slate-500">Stored in this browser only, up to 30 matches.</p>

        {matches && matches.length === 0 && (
          <p className="mt-8 text-slate-600">
            No matches yet.
            <Link href="/" className="ml-1 text-teal-700 underline">
              Run your first match
            </Link>
          </p>
        )}

        <ul className="mt-6 space-y-3">
          {matches?.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">
                  {m.brand.entity?.name || m.brand.name} × {m.creator.channelName || 'creator'}
                </p>
                <p className="text-sm text-slate-500">
                  {new Date(m.createdAt).toLocaleString('en-US')}
                  {m.cachedAt && ' · cached result'}
                </p>
              </div>
              <p className="text-right">
                <span className="text-2xl font-bold tabular-nums text-slate-900">{m.compatibility.fitScore ?? '—'}</span>
                <span className="ml-2 text-sm text-slate-600">{VERDICT_LABELS[m.compatibility.verdict]}</span>
              </p>
              <div className="flex gap-3 text-sm">
                <Link href={`/match/${m.id}`} className="text-teal-700 hover:underline">
                  Open
                </Link>
                {m.status === 'completed' && (
                  <Link href={`/match/${m.id}?print=1`} className="text-teal-700 hover:underline">
                    Export PDF
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
