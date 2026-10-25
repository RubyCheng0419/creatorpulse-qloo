'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useState, useSyncExternalStore } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { MatchResult } from '@/components/match/MatchResult';
import { saveMatch, useMatches } from '@/lib/history';
import type { Match } from '@/lib/match';
import { requestMatch } from '@/lib/match-client';

const noop = () => () => {};

// A saved result from this browser's history. ?print=1 opens the print (PDF) dialog.
// The id is only known at request time, so the content sits in a Suspense boundary.
export default function SavedMatchPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 print:max-w-none print:p-0">
        <Suspense fallback={null}>
          <SavedMatch />
        </Suspense>
      </main>
    </>
  );
}

function SavedMatch() {
  const { id } = useParams<{ id: string }>();
  const matches = useMatches();
  const autoPrint = useSyncExternalStore(
    noop,
    () => new URLSearchParams(window.location.search).get('print') === '1',
    () => false
  );
  // undefined while history is still unknown (server render), null when not found.
  const match = matches === null ? undefined : (matches.find((m) => m.id === id) ?? null);

  if (match === null) {
    return (
      <div className="text-slate-600">
        <p>Match {id} is not in this browser’s history. History is stored only on the device that ran the match.</p>
        <Link href="/" className="mt-2 inline-block text-teal-700 underline">
          Run a new match
        </Link>
      </div>
    );
  }
  return match ? (
    <SavedMatchResult match={match} autoPrint={autoPrint && match.status === 'completed'} />
  ) : null;
}

// "Run live" re-runs the stored inputs with every cache bypassed. The match id comes
// from the inputs, so saving the new result replaces this entry and the page updates.
function SavedMatchResult({ match, autoPrint }: { match: Match; autoPrint: boolean }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runLive() {
    setRunning(true);
    setError(null);
    try {
      const outcome = await requestMatch(
        {
          videoUrls: match.creator.videoUrls,
          brandName: match.brand.name,
          category: match.brand.category ?? undefined,
          referenceBrands: match.brand.referenceBrands,
          live: true,
        },
        () => {},
        new AbortController().signal
      );
      if (outcome.ok) saveMatch(outcome.match);
      else setError(outcome.error);
    } catch (e: any) {
      setError(`Connection failed: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </p>
      )}
      <MatchResult match={match} autoPrint={autoPrint} onRunLive={runLive} running={running} />
    </>
  );
}
