'use client';

import { useEffect, useRef, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { MatchResult } from '@/components/match/MatchResult';
import { ProgressPanel } from '@/components/match/ProgressPanel';
import { StepIndicator } from '@/components/match/StepIndicator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DEMO_PAIR } from '@/lib/demo-pair';
import { saveMatch } from '@/lib/history';
import type { Match } from '@/lib/match';
import { requestMatch } from '@/lib/match-client';
import type { MatchStage } from '@/lib/stages';
import { MAX_VIDEOS, parseVideoId } from '@/lib/youtube-url';

// PRODUCT_SPEC v3.1 §3.1: the four steps on one page, plus the one-click demo (§3.3).

type Step = 1 | 2 | 3 | 4;

const CATEGORIES = ['Technology', 'Sports', 'Beauty', 'Food & Beverage', 'Automotive', 'Fashion'];

export default function MatchPage() {
  const [step, setStep] = useState<Step>(1);
  const [urlsText, setUrlsText] = useState('');
  const [brandName, setBrandName] = useState('');
  const [category, setCategory] = useState('');
  const [done, setDone] = useState<MatchStage[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<{ message: string; backTo: Step; invalid?: string[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const lines = urlsText.split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean);
  const checks = lines.map((line) => ({ line, id: parseVideoId(line) }));
  const invalidCount = checks.filter((c) => !c.id).length;
  const tooMany = lines.length > MAX_VIDEOS;
  const canContinue = lines.length > 0 && !invalidCount && !tooMany;

  useEffect(() => {
    if (step !== 3) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [step]);

  async function analyse(input: { videoUrls: string[]; brandName: string; category?: string }) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDone([]);
    setElapsed(0);
    setError(null);
    setMatch(null);
    setStep(3);

    try {
      const outcome = await requestMatch(input, (s) => setDone((d) => [...d, s]), controller.signal);
      if (outcome.ok) {
        saveMatch(outcome.match);
        setMatch(outcome.match);
        setStep(4);
      } else {
        // Video problems send the user back to step 1, everything else to step 2.
        const videoProblem = Boolean(outcome.invalid) || outcome.status === 422 || /video/i.test(outcome.error);
        setError({ message: outcome.error, backTo: videoProblem ? 1 : 2, invalid: outcome.invalid });
        setStep(videoProblem ? 1 : 2);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError({ message: `Connection failed: ${e?.message || e}`, backTo: 2 });
      setStep(2);
    }
  }

  function runDemo() {
    setUrlsText(DEMO_PAIR.videoUrls.join('\n'));
    setBrandName(DEMO_PAIR.brandName);
    setCategory(DEMO_PAIR.category);
    analyse({ videoUrls: DEMO_PAIR.videoUrls, brandName: DEMO_PAIR.brandName, category: DEMO_PAIR.category });
  }

  function cancel() {
    abortRef.current?.abort();
    setStep(2);
  }

  function reset() {
    setMatch(null);
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
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
              <label htmlFor="urls" className="text-base font-semibold text-slate-900">
                The creator’s YouTube videos
              </label>
              <p className="mt-1 text-sm text-slate-500">Paste 1–{MAX_VIDEOS} video URLs, one per line.</p>
              <Textarea
                id="urls"
                rows={6}
                value={urlsText}
                onChange={(e) => setUrlsText(e.target.value)}
                placeholder={'https://www.youtube.com/watch?v=...\nhttps://youtu.be/...'}
                className="mt-3 font-mono"
              />
              {checks.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {checks.map((c, i) => (
                    <li key={i} className={`break-all ${c.id ? 'text-teal-700' : 'text-rose-700'}`}>
                      {c.id ? `✓ Video ${c.id}` : `✗ Not a YouTube video URL: ${c.line}`}
                    </li>
                  ))}
                </ul>
              )}
              {tooMany && (
                <p className="mt-2 text-sm text-rose-700">
                  At most {MAX_VIDEOS} videos; you have {lines.length}.
                </p>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Whether a video is public is checked during analysis; unreadable videos are skipped and reported. Comments are never read.
              </p>
              <Button className="mt-4" size="lg" disabled={!canContinue} onClick={() => setStep(2)}>
                Next
              </Button>
            </section>

            <aside className="rounded-xl border border-teal-200 bg-teal-50 p-6">
              <h2 className="text-base font-semibold text-teal-900">Try the demo</h2>
              <p className="mt-2 text-sm text-teal-900">
                {DEMO_PAIR.brandName} × {DEMO_PAIR.creatorLabel}, using {DEMO_PAIR.videoUrls.length} of the channel’s recent videos. Verified
                end to end; one click runs the whole flow.
              </p>
              <Button className="mt-4 w-full" size="lg" onClick={runDemo}>
                Run demo: {DEMO_PAIR.brandName} × {DEMO_PAIR.creatorLabel}
              </Button>
            </aside>
          </div>
        )}

        {step === 2 && (
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <p className="text-sm text-slate-500">
              {lines.length} video{lines.length === 1 ? '' : 's'} added
            </p>
            <label htmlFor="brand" className="mt-4 block text-base font-semibold text-slate-900">
              Brand
            </label>
            <Input
              id="brand"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && brandName.trim()) analyse({ videoUrls: lines, brandName, category });
              }}
              placeholder="e.g. Apple, Nike, Sony"
              className="mt-2 max-w-md"
              autoFocus
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

            <div className="mt-6 flex gap-3">
              <Button variant="outline" size="lg" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button size="lg" disabled={!brandName.trim()} onClick={() => analyse({ videoUrls: lines, brandName, category })}>
                Analyze compatibility
              </Button>
            </div>
          </section>
        )}

        {step === 3 && (
          <ProgressPanel
            title={`${brandName || 'brand'} × ${lines.length} video${lines.length === 1 ? '' : 's'}`}
            done={done}
            elapsed={elapsed}
            onCancel={cancel}
          />
        )}

        {step === 4 && match && <MatchResult match={match} onReset={reset} />}
      </main>
    </>
  );
}
