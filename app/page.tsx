'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { Tour } from '@/components/Tour';
import { CHECK_TOUR } from '@/components/tours';
import { ComparisonTable } from '@/components/compare/ComparisonTable';
import { MatchResult } from '@/components/match/MatchResult';
import { ProgressPanel } from '@/components/match/ProgressPanel';
import { StepIndicator } from '@/components/match/StepIndicator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DEMO_PAIRS, type DemoPair } from '@/lib/demo-pair';
import { saveMatch } from '@/lib/history';
import type { Match } from '@/lib/match';
import { type MatchRequest, requestMatch } from '@/lib/match-client';
import { decisionSummary, summaryContext } from '@/lib/report';
import type { MatchStage } from '@/lib/stages';
import { CHANNEL_VIDEOS, MAX_VIDEOS, channelLabel, parseChannelRef, parseVideoId } from '@/lib/youtube-url';
import { errorMessage, caught } from '@/lib/errors';

// PRODUCT_SPEC v3.1 §3.1: the four steps on one page, plus the one-click demo (§3.3).
// The brand comes first, as in Find creators; step 2 takes one creator, or two to compare.

type Step = 1 | 2 | 3 | 4;
type Mode = 'one' | 'two';
type BrandInput = Omit<MatchRequest, 'videoUrls'>;

const CATEGORIES = ['Technology', 'Sports', 'Beauty', 'Food & Beverage', 'Automotive', 'Fashion'];

// useSearchParams needs a Suspense boundary for the static build.
export default function Page() {
  return (
    <Suspense>
      <MatchPage />
    </Suspense>
  );
}

// "Analyze videos" from Find creators links here with ?videos=<channel>&brand=… (and the
// brand fallback as refs=a|b and desc=…), which prefills the form and starts the match.
// A shared report link (lib/share-link) uses the same parameters, with one videos= per video
// and the brand's category.
function linkedRequest(params: URLSearchParams): MatchRequest | null {
  const videos = params.getAll('videos').filter(Boolean).slice(0, MAX_VIDEOS);
  const brand = params.get('brand');
  if (!videos.length || !brand) return null;
  const refs = params.get('refs')?.split('|').filter(Boolean);
  const desc = params.get('desc');
  const category = params.get('category');
  return {
    videoUrls: videos,
    brandName: brand,
    ...(category ? { category } : {}),
    ...(refs?.length ? { referenceBrands: refs } : {}),
    ...(desc ? { brandDescription: desc } : {}),
  };
}

// One creator's input: 1–MAX_VIDEOS video URLs, or one channel URL.
function parseCreator(text: string) {
  const lines = text.split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean);
  // One channel URL reads that channel's latest uploads instead of picked videos.
  const channel = lines.length === 1 && !parseVideoId(lines[0]) ? parseChannelRef(lines[0]) : null;
  const checks = lines.map((line) => ({ line, id: parseVideoId(line) }));
  const invalidCount = channel ? 0 : checks.filter((c) => !c.id).length;
  const tooMany = lines.length > MAX_VIDEOS;
  const label = channel ? channelLabel(channel) : `${lines.length} video${lines.length === 1 ? '' : 's'}`;
  return { lines, channel, checks, tooMany, label, ok: lines.length > 0 && !invalidCount && !tooMany };
}

const brandProblem = (m: Match) => !m.brand.entity && !m.brand.basis;
// analyse() runs from handlers and the link effect only, never during render.
const now = () => Date.now();

function MatchPage() {
  const params = useSearchParams();
  const [linked] = useState(() => linkedRequest(params)); // read once, on the first render
  const linkedRan = useRef(false);
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>('one');
  const [creatorTexts, setCreatorTexts] = useState(() => [linked?.videoUrls.join('\n') ?? '', '']);
  const [brandName, setBrandName] = useState(linked?.brandName ?? '');
  const [category, setCategory] = useState(linked?.category ?? '');
  const [done, setDone] = useState<MatchStage[]>([]);
  const [doneAt, setDoneAt] = useState<Partial<Record<MatchStage, number>>>({}); // ms since the request started
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState({ index: 0, total: 1, label: '' });
  const [results, setResults] = useState<Match[]>([]);
  const [error, setError] = useState<{ message: string; backTo: Step; invalid?: string[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRun = useRef<{ brand: BrandInput; creators: string[][] } | null>(null);

  const creators = creatorTexts.slice(0, mode === 'two' ? 2 : 1).map(parseCreator);
  const canAnalyse = creators.every((c) => c.ok);

  useEffect(() => {
    if (step !== 3 || !startedAt) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [step, startedAt]);

  // Each creator is its own request, one after the other: one analysis fits the function time
  // limit, two in one request might not, and both share the Qloo rate limit.
  // `keep`: results already in hand that lead the comparison as they are (not re-run).
  async function analyse(brand: BrandInput, creatorUrls: string[][], keep: Match[] = []) {
    lastRun.current = { brand, creators: [...keep.map((m) => m.creator.videoUrls), ...creatorUrls] };
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setResults([]);
    setStep(3);

    const matches: Match[] = [...keep];
    for (const [j, videoUrls] of creatorUrls.entries()) {
      const i = j + keep.length;
      setDone([]);
      setDoneAt({});
      const start = now();
      setStartedAt(start);
      setElapsed(0);
      setRunning({ index: i, total: creatorUrls.length + keep.length, label: parseCreator(videoUrls.join('\n')).label });
      try {
        const outcome = await requestMatch(
          { ...brand, videoUrls },
          (s) => {
            setDone((d) => [...d, s]);
            setDoneAt((t) => ({ ...t, [s]: now() - start }));
          },
          controller.signal
        );
        if (!outcome.ok) {
          // Video problems send the user back to the creator step, everything else to the brand.
          const videoProblem = Boolean(outcome.invalid) || outcome.status === 422 || /video/i.test(outcome.error);
          const who = creatorUrls.length + keep.length > 1 ? `Creator ${i ? 'B' : 'A'}: ` : '';
          setError({ message: who + outcome.error, backTo: videoProblem ? 2 : 1, invalid: outcome.invalid });
          setStep(videoProblem ? 2 : 1);
          return;
        }
        saveMatch(outcome.match);
        matches.push(outcome.match);
        // The brand isn't in Qloo: the second creator would hit the same wall, and the single
        // result offers the ways around it.
        if (brandProblem(outcome.match)) break;
      } catch (e) {
        if (caught(e).name === 'AbortError') return;
        setError({ message: `Connection failed: ${errorMessage(e)}`, backTo: 1 });
        setStep(1);
        return;
      }
    }
    setResults(matches);
    setStep(4);
  }

  const brandInput = (): BrandInput => ({ brandName, ...(category ? { category } : {}) });
  const runForm = () => analyse(brandInput(), creators.map((c) => c.lines));

  // Runs once for a linked request (the ref guards against React running effects twice).
  // ?edit=1 (from a saved result's "Edit the brand or videos") only fills the form in.
  useEffect(() => {
    if (!linked || linkedRan.current || params.get('edit') === '1') return;
    linkedRan.current = true;
    const { videoUrls, ...brand } = linked;
    analyse(brand, [videoUrls]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runDemo(pair: DemoPair) {
    setMode('one');
    setCreatorTexts([pair.videoUrls.join('\n'), creatorTexts[1]]);
    setBrandName(pair.brandName);
    setCategory(pair.category);
    analyse({ brandName: pair.brandName, category: pair.category }, [pair.videoUrls]);
  }

  // Re-runs the last request with a changed brand side (the same creators).
  const rerun = (change: Partial<BrandInput>) => lastRun.current && analyse({ ...lastRun.current.brand, ...change }, lastRun.current.creators);

  // Re-runs the last brand side with other videos or a channel, from an insufficient-data
  // result; the form keeps them, so going back shows what actually ran.
  // Creator B next to the result on screen (creator A, kept as it is), for the same brand side.
  function compareWith(videoUrls: string[]) {
    const a = results[0];
    if (!lastRun.current || !a) return;
    setMode('two');
    setCreatorTexts([a.creator.videoUrls.join('\n'), videoUrls.join('\n')]);
    analyse(lastRun.current.brand, [videoUrls], [a]);
  }

  function rerunCreator(videoUrls: string[]) {
    if (!lastRun.current) return;
    setMode('one');
    setCreatorTexts([videoUrls.join('\n'), creatorTexts[1]]);
    analyse(lastRun.current.brand, [videoUrls]);
  }

  function cancel() {
    abortRef.current?.abort();
    setStep(2);
  }

  function reset() {
    setResults([]);
    setError(null);
    setStep(1);
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 print:max-w-none print:p-0">
        {step === 1 && (
          <div className="mb-8 print:hidden">
            <h1 className="text-3xl font-bold text-slate-900">Will this partnership clash culturally?</h1>
            <p className="mt-2 max-w-2xl text-slate-600">
              Not follower counts or engagement rates. CreatorPulse uses Qloo’s cross-domain taste graph to compare a brand’s
              audience with a creator’s content, and every point of the score traces back to specific Qloo entities.
            </p>
            <p className="mt-3 max-w-2xl text-sm text-slate-500">
              <span className="font-medium text-slate-700">Works best</span> for creators whose titles and descriptions name brands,
              products, shows or people (tech reviewers, for example). Channels that rarely name anything, like many kids’ or cooking
              channels, may get “insufficient data” instead of a score.
            </p>
            <Link href="/how-it-works" data-tour="how-it-works" className="mt-3 inline-block text-sm font-medium text-teal-700 hover:underline">
              How the score works →
            </Link>
          </div>
        )}

        <div className="mb-6">
          <StepIndicator current={step} />
        </div>

        {error && step !== 3 && (
          <div role="alert" className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <p className="font-medium">{error.message}</p>
            {error.invalid && (
              <ul className="mt-1 list-disc pl-5">
                {error.invalid.map((u) => (
                  <li key={u} className="break-all">
                    {u}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
            <section data-tour="check-brand" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
              <label htmlFor="brand" className="text-base font-semibold text-slate-900">
                Your brand
              </label>
              <Input
                id="brand"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && brandName.trim()) setStep(2);
                }}
                placeholder="e.g. Apple, Nike, Sony"
                className="mt-2 max-w-md"
              />
              <p className="mt-1 text-xs text-slate-500">Use the brand’s English name. If Qloo has no exact match, we say so instead of guessing a similar brand.</p>

              <label htmlFor="category" className="mt-5 block text-sm font-medium text-slate-900">
                Category (optional)
              </label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-2 h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">Any</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">Only used to pick between brands that share a name.</p>

              <Button className="mt-6" size="lg" disabled={!brandName.trim()} onClick={() => setStep(2)}>
                Next
              </Button>
            </section>

            {/* First on a phone: the demo is what most first-time visitors are here for. */}
            <aside data-tour="check-demo" className="order-first rounded-xl border border-teal-200 bg-teal-50 p-4 sm:p-6 lg:order-none">
              <h2 className="text-base font-semibold text-teal-900">Try the demo</h2>
              <p className="mt-2 text-sm text-teal-900">
                The same {DEMO_PAIRS[0].creatorLabel} videos against two brands. Each click runs the full pipeline live.
              </p>
              {DEMO_PAIRS.map((pair) => (
                <div key={pair.key} className="mt-4">
                  <Button className="w-full" size="lg" variant={pair.key === 'fit' ? 'default' : 'outline'} onClick={() => runDemo(pair)}>
                    {pair.key === 'fit' ? 'Run demo' : 'Try a mismatch'}: {pair.brandName} × {pair.creatorLabel}
                  </Button>
                  <p className="mt-1 text-xs text-teal-900/80">
                    {pair.key === 'fit'
                      ? 'A tech reviewer and a tech brand.'
                      : 'Same tech reviewer, a diaper brand: the score drops and conflicting taste appears.'}
                  </p>
                </div>
              ))}
              <Link href="/compare?demo=1" className="mt-4 block text-sm font-medium text-teal-800 hover:underline">
                Compare three creators for Apple →
              </Link>
            </aside>
          </div>
        )}

        {step === 2 && (
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <p className="text-sm text-slate-500">
              Brand: <span className="font-medium text-slate-700">{brandName}</span>
              {category ? ` · ${category}` : ''}
            </p>
            <fieldset className="mt-4">
              <legend className="text-base font-semibold text-slate-900">Creators</legend>
              <div className="mt-2 inline-flex rounded-lg bg-slate-100 p-1 text-sm" role="radiogroup">
                {(
                  [
                    ['one', 'One creator'],
                    ['two', 'Compare two creators'],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-md px-3 py-1.5 font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-600 ${
                      mode === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="mt-3 text-sm text-slate-500">
              For each creator, paste 1–{MAX_VIDEOS} video URLs, one per line, or one channel URL (e.g. youtube.com/@mkbhd) to read its
              latest {CHANNEL_VIDEOS} videos.
              {mode === 'two' && ' The two are analysed one after the other, so this takes about twice as long.'}
            </p>

            <div className={`mt-4 grid gap-5 ${mode === 'two' ? 'md:grid-cols-2' : ''}`}>
              {creators.map((c, i) => (
                <CreatorField
                  key={i}
                  id={`creator-${i}`}
                  label={mode === 'two' ? `Creator ${i ? 'B' : 'A'}` : 'The creator’s YouTube videos'}
                  rows={mode === 'two' ? 5 : 6}
                  value={creatorTexts[i]}
                  parsed={c}
                  onChange={(v) => setCreatorTexts((t) => t.map((x, j) => (j === i ? v : x)))}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Whether a video is public is checked during analysis; unreadable videos are skipped and reported. Comments are never read.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="outline" size="lg" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button size="lg" disabled={!canAnalyse} onClick={runForm}>
                {mode === 'two' ? 'Compare creators' : 'Analyze compatibility'}
              </Button>
            </div>
          </section>
        )}

        {step === 3 && (
          <ProgressPanel
            title={`${running.total > 1 ? `creator ${running.index + 1} of ${running.total}: ` : ''}${brandName || 'brand'} × ${running.label}`}
            done={done}
            doneAt={doneAt}
            elapsed={elapsed}
            onCancel={cancel}
          />
        )}

        {step === 4 && results.length === 1 && (
          <MatchResult
            match={results[0]}
            onReset={reset}
            onRunLive={() => rerun({ live: true })}
            onUseBrand={(brand) => {
              setBrandName(brand);
              rerun({ brandName: brand, referenceBrands: undefined, brandDescription: undefined });
            }}
            onBrandFallback={(fallback) => rerun(fallback)}
            onRerunCreator={rerunCreator}
            onCompare={compareWith}
          />
        )}

        {step === 4 && results.length > 1 && <TwoCreators matches={results} onReset={reset} />}
      </main>
      {/* Only on the form: a linked or shared run goes straight to its result. */}
      {step === 1 && <Tour id="check" steps={CHECK_TOUR} autoStart={!linked} />}
    </>
  );
}

function CreatorField({
  id,
  label,
  rows,
  value,
  parsed,
  onChange,
}: {
  id: string;
  label: string;
  rows: number;
  value: string;
  parsed: ReturnType<typeof parseCreator>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-slate-900">
        {label}
      </label>
      <Textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={'https://www.youtube.com/watch?v=...\nhttps://youtu.be/...'}
        className="mt-2 font-mono"
      />
      {parsed.channel && <p className="mt-2 text-sm text-teal-700">✓ Channel {parsed.label}: its latest {CHANNEL_VIDEOS} videos will be read</p>}
      {parsed.checks.length > 0 && !parsed.channel && (
        <ul className="mt-2 space-y-1 text-sm">
          {parsed.checks.map((c, i) => (
            <li key={i} className={`break-all ${c.id ? 'text-teal-700' : 'text-rose-700'}`}>
              {c.id ? `✓ Video ${c.id}` : `✗ Not a YouTube video URL: ${c.line}`}
            </li>
          ))}
        </ul>
      )}
      {parsed.tooMany && (
        <p className="mt-2 text-sm text-rose-700">
          At most {MAX_VIDEOS} videos; you have {parsed.lines.length}.
        </p>
      )}
    </div>
  );
}

// Two creators for one brand: the comparison first, each creator's decision under it, and
// every row opens its full result (both are in History).
function TwoCreators({ matches, onReset }: { matches: Match[]; onReset: () => void }) {
  const brand = matches[0].brand.entity?.name || matches[0].brand.name;
  const name = (m: Match) => m.creator.channelName || m.creator.youtubeHandle || 'Creator';
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <p className="text-sm text-slate-500">Cultural compatibility due diligence · comparison</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">
          {brand}: {matches.map(name).join(' vs ')}
        </h2>
        <p className="mt-1 text-sm text-slate-600">Same brand, same formula, side by side. Open a creator for the full result, its evidence and the Agent Trace.</p>
        <ul className="mt-4 space-y-2 text-sm text-slate-700">
          {matches.map((m) => {
            const d = decisionSummary(m.compatibility, summaryContext(m));
            return (
              <li key={m.id}>
                <Link href={`/match/${m.id}`} className="font-medium text-slate-900 hover:text-teal-700 hover:underline">
                  {name(m)}
                </Link>
                {' — '}
                {d ? (
                  <>
                    <span className="font-semibold text-slate-900">{d.verdict}:</span> {d.condition}
                  </>
                ) : (
                  m.errorMessage || 'No score.'
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <ComparisonTable matches={matches} />
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button className="sm:ml-auto" onClick={onReset}>
          Run another match
        </Button>
      </div>
    </div>
  );
}
