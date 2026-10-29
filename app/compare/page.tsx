'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { ComparisonTable } from '@/components/compare/ComparisonTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveMatch, useMatches } from '@/lib/history';
import type { Match } from '@/lib/match';
import { requestMatch } from '@/lib/match-client';
import { parseChannelRef, parseVideoId } from '@/lib/youtube-url';

// Comparison mode: one brand, two or three creators side by side, so one score has reference
// points. ?demo=1 shows the saved demo comparison (public/demo-compare.json, real runs, no API
// quota spent); ?brand=… shows this browser's matches for that brand and adds creators to it.

type Demo = { brandName: string; savedAt: string; matches: Match[] };

// When the runs were made: rows can be re-saved one at a time (the MKBHD row comes from the
// demo snapshot), so the comparison gives each run's own date, not the file's.
function savedOn(matches: Match[]): string {
  const day = (m: Match) => new Date(m.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const byDay = new Map<string, string[]>();
  for (const m of [...matches].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) byDay.set(day(m), [...(byDay.get(day(m)) ?? []), m.creator.channelName]);
  if (byDay.size === 1) return [...byDay.keys()][0];
  return [...byDay].map(([d, names]) => `${d} (${names.join(', ')})`).join(' and ');
}
const MAX_CREATORS = 3;

export default function Page() {
  return (
    <Suspense>
      <ComparePage />
    </Suspense>
  );
}

const sameBrand = (m: Match, brand: string) =>
  [m.brand.name, m.brand.entity?.name].some((n) => n && n.trim().toLocaleLowerCase() === brand.trim().toLocaleLowerCase());

function ComparePage() {
  const params = useSearchParams();
  const demo = params.get('demo') === '1';
  const brand = params.get('brand') || '';
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-3xl font-bold text-slate-900">Compare creators for one brand</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          A Fit Score means more next to others for the same brand: up to {MAX_CREATORS} creators, scored with the same formula, side by side.
        </p>
        <div className="mt-6">{demo ? <DemoComparison /> : brand ? <BrandComparison brand={brand} /> : <Start />}</div>
      </main>
    </>
  );
}

function Start() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 sm:p-6">
      <p>
        Open a result and choose <span className="font-medium">Compare with another creator</span>, or choose two creators in{' '}
        <Link href="/" className="font-medium text-teal-700 hover:underline">
          Check a creator
        </Link>
        , or{' '}
        <Link href="/compare?demo=1" className="font-medium text-teal-700 hover:underline">
          see the demo comparison for Apple
        </Link>
        .
      </p>
    </div>
  );
}

function DemoComparison() {
  const [data, setData] = useState<Demo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/demo-compare.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(Error(`HTTP ${r.status}`))))
      .then((d: Demo) => {
        // Saved runs, labelled as such; kept in History so each row opens its full result.
        const matches = d.matches.map((m) => ({ ...m, cachedAt: m.createdAt, cachedReason: 'demo' as const }));
        matches.forEach(saveMatch);
        setData({ ...d, matches });
      })
      .catch((e) => setError(`The demo comparison couldn’t be loaded (${e.message}).`));
  }, []);
  if (error) return <p className="text-sm text-rose-800">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="space-y-3">
      <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-950 ring-1 ring-sky-200">
        <span className="font-semibold">Cached</span> demo comparison: real runs of the full pipeline for {data.brandName}, saved{' '}
        {savedOn(data.matches)}, so it spends no API quota. Open a row for its full result and Run live.
      </p>
      <ComparisonTable matches={data.matches} />
      <p className="text-xs text-slate-500">
        Two tech reviewers and a beauty creator. The beauty creator’s videos named too little, so her score comes from her audience’s taste in
        Qloo. Apple’s audience is broad: no creator tried scored below 55; for a pair that clearly doesn’t fit, see Huggies × MKBHD on the home page.
      </p>
    </div>
  );
}

function BrandComparison({ brand }: { brand: string }) {
  const history = useMatches();
  const rows = (history ?? []).filter((m) => sameBrand(m, brand)).slice(0, MAX_CREATORS);
  const [url, setUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const valid = Boolean(parseVideoId(url.trim()) || parseChannelRef(url.trim()));
  const category = rows.find((m) => m.brand.category)?.brand.category ?? undefined;

  async function add() {
    setRunning(true);
    setError(null);
    abort.current = new AbortController();
    try {
      const outcome = await requestMatch({ videoUrls: [url.trim()], brandName: brand, ...(category ? { category } : {}) }, () => {}, abort.current.signal);
      if (outcome.ok) {
        saveMatch(outcome.match);
        setUrl('');
      } else setError(outcome.error);
    } catch (e) {
      setError(`Connection failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">{brand}</h2>
      {rows.length ? (
        <ComparisonTable matches={rows} />
      ) : (
        <p className="text-sm text-slate-600">No results for {brand} in this browser yet. Add a creator below.</p>
      )}
      {rows.length < MAX_CREATORS ? (
        <form
          className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !running) add();
          }}
        >
          <label htmlFor="add-url" className="text-sm font-semibold text-slate-900">
            Add a creator for {brand}
          </label>
          <p className="mt-1 text-xs text-slate-500">One YouTube video or channel URL (a channel reads its latest 15 videos). About 15 seconds.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input id="add-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/@channel" className="max-w-md" />
            <Button type="submit" disabled={!valid || running}>
              {running ? 'Analyzing…' : 'Add to comparison'}
            </Button>
          </div>
          {error && <p className="mt-2 text-sm text-rose-800">{error}</p>}
        </form>
      ) : (
        <p className="text-xs text-slate-500">Showing the {MAX_CREATORS} most recent results for {brand} in this browser.</p>
      )}
    </div>
  );
}
