'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useSyncExternalStore } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { MatchResult } from '@/components/match/MatchResult';
import { useMatches } from '@/lib/history';

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
  return match ? <MatchResult match={match} autoPrint={autoPrint && match.status === 'completed'} /> : null;
}
