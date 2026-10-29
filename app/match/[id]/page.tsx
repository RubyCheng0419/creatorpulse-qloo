'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Suspense, useState, useSyncExternalStore } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { ComparisonTable } from '@/components/compare/ComparisonTable';
import { MatchResult } from '@/components/match/MatchResult';
import { Button } from '@/components/ui/button';
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
// From an insufficient-data result, the same brand side can be re-run with other videos or the
// channel; that is a new match (its id comes from the videos), so the page moves to it.
function SavedMatchResult({ match, autoPrint }: { match: Match; autoPrint: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compared, setCompared] = useState<Match | null>(null); // creator B, next to this result

  async function run(videoUrls: string[], live: boolean, compare = false) {
    setRunning(
      live ? 'Running live…' : compare ? 'Analysing creator B for the same brand…' : `Re-running ${match.brand.entity?.name || match.brand.name} with the new videos…`
    );
    setError(null);
    try {
      const outcome = await requestMatch(
        {
          videoUrls,
          brandName: match.brand.name,
          category: match.brand.category ?? undefined,
          referenceBrands: match.brand.referenceBrands,
          brandDescription: match.brand.description,
          ...(live ? { live: true } : {}),
        },
        () => {},
        new AbortController().signal
      );
      if (outcome.ok) {
        saveMatch(outcome.match);
        if (compare) {
          setCompared(outcome.match);
          window.scrollTo({ top: 0, behavior: 'instant' }); // the comparison sits above the result
        }
        else if (outcome.match.id !== match.id) router.push(`/match/${outcome.match.id}`);
      } else setError(outcome.error);
    } catch (e: any) {
      setError(`Connection failed: ${e?.message || e}`);
    } finally {
      setRunning(null);
    }
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </p>
      )}
      {running && (
        <p role="status" className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {running} This takes about 10–30 seconds.
        </p>
      )}
      {compared && (
        <section className="mb-4 space-y-3" aria-label="Comparison">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold text-slate-900">
              {match.brand.entity?.name || match.brand.name}: {[match, compared].map((m) => m.creator.channelName || m.creator.youtubeHandle || 'Creator').join(' vs ')}
            </h2>
            <Button variant="outline" onClick={() => setCompared(null)}>
              Close comparison
            </Button>
          </div>
          <p className="text-sm text-slate-600">Same brand, same formula, side by side. This result is below; open the other row for its full result.</p>
          <ComparisonTable matches={[match, compared]} />
        </section>
      )}
      <MatchResult
        match={match}
        autoPrint={autoPrint}
        onRunLive={() => run(match.creator.videoUrls, true)}
        onRerunCreator={(videoUrls) => run(videoUrls, false)}
        onCompare={(videoUrls) => run(videoUrls, false, true)}
        running={running !== null}
      />
    </>
  );
}
