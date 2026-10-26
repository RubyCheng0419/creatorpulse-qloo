'use client';

import { useEffect, useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { CandidateCard } from '@/components/discover/CandidateCard';
import { AgentTrace } from '@/components/match/AgentTrace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CREATOR_CATEGORIES, type CreatorCategory } from '@/lib/creator-categories';
import type { Discovery } from '@/lib/discover';
import { NO_DATA_NEXT_STEPS } from '@/lib/no-data';
import { brandBasisNote } from '@/lib/report';

// "Find creators": the brand goes in, Qloo's YouTubers come out ranked by how their
// audience's taste relates to the brand's. Each one links to the video deep dive on "/".

type Image = { data: string; mimeType: string; preview: string };
type Request = {
  brandName: string;
  creatorCategory: CreatorCategory;
  referenceBrands?: string[];
  brandDescription?: string;
  image?: { data: string; mimeType: string };
  live?: boolean;
};

const DEMOS: { brandName: string; note: string }[] = [
  { brandName: 'Apple', note: 'A tech brand' },
  { brandName: 'Huggies', note: 'A family brand' },
  { brandName: 'Le Labo Fragrances', note: 'A niche fragrance brand' },
];

const STEPS = ['Resolving the brand in Qloo', 'Finding candidate YouTubers', 'Reading each creator’s audience taste', 'Scoring and ranking'];

// Key visuals are scaled down in the browser (longest side 1024 px, JPEG) before upload.
async function loadImage(file: File): Promise<Image> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new window.Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file isn’t an image the browser can read.'));
      i.src = url;
    });
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const preview = canvas.toDataURL('image/jpeg', 0.85);
    return { data: preview.split(',')[1], mimeType: 'image/jpeg', preview };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function DiscoverPage() {
  const [brandName, setBrandName] = useState('');
  const [creatorCategory, setCreatorCategory] = useState<CreatorCategory>('any');
  const [moreOpen, setMoreOpen] = useState(false);
  const [refs, setRefs] = useState(['', '', '']);
  const [description, setDescription] = useState('');
  const [image, setImage] = useState<Image | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Discovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Request | null>(null); // the request behind the result

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);

  function currentRequest(overrides: Partial<Request> = {}): Request {
    const referenceBrands = refs.map((r) => r.trim()).filter(Boolean);
    return {
      brandName,
      creatorCategory,
      ...(referenceBrands.length ? { referenceBrands } : {}),
      ...(description.trim() ? { brandDescription: description.trim() } : {}),
      ...(image ? { image: { data: image.data, mimeType: image.mimeType } } : {}),
      ...overrides,
    };
  }

  async function find(req: Request) {
    if (!req.brandName.trim()) return;
    setLast(req);
    setRunning(true);
    setElapsed(0);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/discover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setError(d.error || `Server returned ${r.status}`);
      else {
        setResult(d);
        if (d.status !== 'completed' && !d.brand?.basis) setMoreOpen(true); // the brand side needs help
      }
    } catch (e: any) {
      setError(`Connection failed: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  }

  function runDemo(name: string) {
    setBrandName(name);
    setCreatorCategory('any');
    setRefs(['', '', '']);
    setDescription('');
    setImage(null);
    find({ brandName: name, creatorCategory: 'any' });
  }

  const basisNote = result ? brandBasisNote(result.brand) : null;
  const missing = new Map((result?.brand.missingReferences ?? []).map((m) => [m.name, m.suggestions]));
  const deepDive = (c: Discovery['candidates'][number]) => {
    if (!c.channel || !last) return null;
    const q = new URLSearchParams({ videos: c.channel.url, brand: last.brandName });
    if (last.referenceBrands) q.set('refs', last.referenceBrands.join('|'));
    if (last.brandDescription) q.set('desc', last.brandDescription);
    return `/?${q}`;
  };

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Which creators share your audience’s taste?</h1>
          <p className="mt-2 max-w-2xl text-slate-600">
            Enter your brand. Qloo ranks its YouTubers by how strongly your audience relates to them, then CreatorPulse scores each one
            on the music, films, brands and places their audience likes. Every point traces back to a Qloo entity.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <label htmlFor="brand" className="text-base font-semibold text-slate-900">
              Your brand
            </label>
            <Input
              id="brand"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && find(currentRequest())}
              placeholder="e.g. Apple, Huggies, Glossier"
              className="mt-2 max-w-md"
            />
            <p className="mt-1 text-xs text-slate-500">Use the brand’s English name. If Qloo has no exact match, we say so instead of guessing.</p>

            <label htmlFor="ctype" className="mt-5 block text-sm font-medium text-slate-900">
              Creator type
            </label>
            <select
              id="ctype"
              value={creatorCategory}
              onChange={(e) => setCreatorCategory(e.target.value as CreatorCategory)}
              className="mt-2 h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              {Object.entries(CREATOR_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">Types come from Qloo’s Wikipedia categories, so coverage is uneven.</p>

            <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} className="mt-5 text-sm font-medium text-teal-700 hover:underline">
              {moreOpen ? '− ' : '+ '}Brand not in Qloo, or want to add more about it?
            </button>
            {moreOpen && (
              <div className="mt-3 space-y-4 rounded-lg border border-slate-200 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">Reference brands (1–3) with a similar audience</p>
                  <p className="text-xs text-slate-500">Used when your brand isn’t in Qloo. Each must match a Qloo brand exactly.</p>
                  <div className="mt-2 space-y-2">
                    {refs.map((r, i) => {
                      const s = missing.get(r.trim());
                      return (
                        <div key={i}>
                          <Input
                            aria-label={`Reference brand ${i + 1}`}
                            value={r}
                            onChange={(e) => setRefs(refs.map((x, j) => (j === i ? e.target.value : x)))}
                            placeholder={i === 0 ? 'e.g. Byredo' : 'optional'}
                            className={`max-w-sm ${s ? 'border-rose-300' : ''}`}
                          />
                          {s && (
                            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-rose-700">
                              Not in Qloo.
                              {s.map((x) => (
                                <Button key={x} type="button" size="sm" variant="outline" onClick={() => setRefs(refs.map((y, j) => (j === i ? x : y)))}>
                                  Use “{x}”
                                </Button>
                              ))}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label htmlFor="desc" className="text-sm font-medium text-slate-900">
                    Brand description or web page
                  </label>
                  <p className="text-xs text-slate-500">
                    Used when there are no reference brands; at least 3 of the names it mentions must match Qloo. With reference brands, its
                    style keywords can add Qloo tags.
                  </p>
                  <Textarea
                    id="desc"
                    rows={3}
                    maxLength={2000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. https://example.com/about, or: Small-batch perfumes inspired by Studio Ghibli films and Kyoto…"
                    className="mt-2"
                  />
                </div>
                <div>
                  <label htmlFor="visual" className="text-sm font-medium text-slate-900">
                    Key visual (optional)
                  </label>
                  <p className="text-xs text-slate-500">
                    Gemini reads its visible style (e.g. minimalism, streetwear); only words that exactly name a Qloo taste tag are used. A
                    weak, supplementary signal: confidence drops one level.
                  </p>
                  <input
                    id="visual"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="mt-2 block text-sm"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      setImageError(null);
                      if (!f) return setImage(null);
                      try {
                        setImage(await loadImage(f));
                      } catch (err: any) {
                        setImage(null);
                        setImageError(err.message);
                      }
                    }}
                  />
                  {imageError && <p className="mt-1 text-xs text-rose-700">{imageError}</p>}
                  {image && (
                    <div className="mt-2 flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.preview} alt="Key visual preview" className="h-16 w-auto rounded border border-slate-200" />
                      <button type="button" onClick={() => setImage(null)} className="text-xs text-slate-500 hover:underline">
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <Button className="mt-6" size="lg" disabled={!brandName.trim() || running} onClick={() => find(currentRequest())}>
              {running ? 'Finding creators…' : 'Find creators'}
            </Button>
          </section>

          <aside className="rounded-xl border border-teal-200 bg-teal-50 p-6">
            <h2 className="text-base font-semibold text-teal-900">Try the demo</h2>
            <p className="mt-2 text-sm text-teal-900">Three very different brands. Each click runs Qloo live; the rankings should differ.</p>
            {DEMOS.map((d) => (
              <div key={d.brandName} className="mt-4">
                <Button className="w-full" variant={d.brandName === 'Apple' ? 'default' : 'outline'} disabled={running} onClick={() => runDemo(d.brandName)}>
                  Find creators for {d.brandName}
                </Button>
                <p className="mt-1 text-xs text-teal-900/80">{d.note}</p>
              </div>
            ))}
          </aside>
        </div>

        {running && (
          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-live="polite">
            <h2 className="text-lg font-semibold text-slate-900">Finding creators for {last?.brandName}</h2>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
              {STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="mt-3 text-sm tabular-nums text-slate-500">{elapsed}s elapsed (usually about 20 seconds)</p>
          </section>
        )}

        {error && (
          <p role="alert" className="mt-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            {error}
          </p>
        )}

        {result && !running && (
          <div className="mt-8 space-y-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Creators for {result.brand.entity?.name || result.brand.name}
                {result.creatorCategory !== 'any' && ` · ${CREATOR_CATEGORIES[result.creatorCategory].label} YouTubers`}
              </h2>
              {basisNote && (
                <p className="mt-2 rounded-md bg-violet-50 px-3 py-2 text-sm font-medium text-violet-900 ring-1 ring-violet-200">
                  {basisNote} <span className="font-normal">Confidence is one level lower than the evidence alone would give.</span>
                </p>
              )}
            </div>

            {result.status === 'completed' ? (
              <>
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-slate-800">Fit Score</span>: how the brand’s audience relates to the brands, music, films,
                  shows and places this creator’s audience likes, all from Qloo, with the same formula as a creator check.{' '}
                  <span className="font-medium text-slate-800">Audience overlap</span>: how strongly the brand’s audience likes the creator
                  themselves; shown, not scored. Confidence is at most Medium here: it is the audience’s inferred taste, not what the creator
                  says. Analyze a creator’s videos to add that.
                </p>
                <ol className="space-y-3">
                  {result.candidates.map((c) => (
                    <CandidateCard key={c.qlooId} c={c} deepDiveHref={deepDive(c)} />
                  ))}
                </ol>
              </>
            ) : (
              <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
                <h3 className="text-base font-semibold">Insufficient data: no ranking</h3>
                <p className="mt-2">{result.errorMessage}</p>
                {!!result.brand.suggestions?.length && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {result.brand.suggestions.map((s) => (
                      <Button
                        key={s}
                        variant="outline"
                        onClick={() => {
                          setBrandName(s);
                          find(currentRequest({ brandName: s }));
                        }}
                      >
                        Use “{s}”
                      </Button>
                    ))}
                  </div>
                )}
                {result.noDataReason && (
                  <ul className="mt-3 list-disc pl-5 text-amber-800">
                    {NO_DATA_NEXT_STEPS[result.noDataReason].map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {!!result.warnings.length && (
              <ul className="list-disc pl-5 text-xs text-slate-500">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            <AgentTrace
              steps={result.trace}
              liveRun={result.liveRun}
              running={running}
              onRunLive={() => last && find({ ...last, live: true })}
            />

            <p className="text-xs text-slate-500">
              Scores are based on Qloo’s taste graph: inferred, aggregate audience taste, not any individual fan’s data. They measure cultural
              fit only, not brand safety, past controversies or audience size. Candidates are limited to the YouTubers Qloo knows.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
