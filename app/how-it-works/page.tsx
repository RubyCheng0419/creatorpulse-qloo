import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { EXPANSION_POPULARITY_MIN } from '@/lib/qloo';
import {
  AFFINITY_FLOOR,
  DIMENSION_LABELS,
  DIRECT_WEIGHT,
  DIVERGENCE_MAX,
  HIGH_CONFIDENCE_ENTITIES,
  INTERSECTION_MIN,
  MEDIUM_CONFIDENCE_ENTITIES,
  MIN_DIRECT_ENTITIES,
  PROXY_WEIGHT,
} from '@/lib/scoring';

export const metadata: Metadata = { title: 'How the score works · CreatorPulse' };

// Every number on this page comes from the constants the scoring code uses (lib/scoring.ts,
// lib/qloo.ts), so the explanation can't drift from the formula.
const points = (a: number) => Math.round(((a - AFFINITY_FLOOR) / (1 - AFFINITY_FLOOR)) * 100);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 pt-6">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-2 text-slate-700">{children}</div>
    </section>
  );
}

export default function HowItWorksPage() {
  const dims = Object.values(DIMENSION_LABELS);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 leading-relaxed">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">How the score works</h1>
          <p className="mt-2 text-slate-600">
            The Fit Score answers one question: how much does the brand’s audience like the things in the creator’s world? Qloo supplies every
            number; a fixed formula, not a language model, turns them into the score.
          </p>
        </div>

        <Section title="1. Affinity, from Qloo">
          <p>
            For each entity on the creator’s side (a brand, artist, film, show or place), Qloo’s <code className="text-sm">/v2/insights</code>{' '}
            returns its <strong>affinity</strong> with the brand as signal: how strongly the brand’s audience likes it, from 0 to 1. CreatorPulse
            doesn’t compute affinity; it only uses entities Qloo confirmed by exact name or alias.
          </p>
        </Section>

        <Section title="2. Affinity to points">
          <p>
            Qloo’s affinities sit between about 0.55 and 0.98, so they are rescaled linearly from [{AFFINITY_FLOOR}, 1] to [0, 100]: points = (affinity −{' '}
            {AFFINITY_FLOOR}) ÷ {1 - AFFINITY_FLOOR} × 100, kept within 0–100. For example, 0.78 → {points(0.78)}, 0.93 → {points(0.93)}. Without this
            every pair would land between 75 and 95.
          </p>
        </Section>

        <Section title="3. Three tiers">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Strong shared taste</strong>: affinity ≥ {INTERSECTION_MIN}.
            </li>
            <li>
              <strong>Some shared taste</strong>: affinity {DIVERGENCE_MAX.toFixed(2)} to {INTERSECTION_MIN}.
            </li>
            <li>
              <strong>Conflicting taste</strong>: affinity below {DIVERGENCE_MAX.toFixed(2)}. Conflicting taste is evidence of mismatch, not missing data.
            </li>
          </ul>
          <p className="text-sm text-slate-500">The tiers explain the score; they don’t add or subtract anything on their own.</p>
        </Section>

        <Section title="4. Weights">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              An entity <strong>named in the creator’s videos</strong> weighs {DIRECT_WEIGHT}.
            </li>
            <li>
              An entity <strong>related by Qloo</strong> (what the same audience also likes, one step removed) weighs {PROXY_WEIGHT}. So does
              every entity of a creator’s audience taste in Find creators.
            </li>
            <li>
              Each entity belongs to one of five dimensions ({dims.join(', ')}). A dimension’s score is the weighted mean of its entities’ points.
            </li>
            <li>
              The <strong>Fit Score</strong> is the equal-weight mean of the dimensions that have data. A dimension without data is left out, never
              counted as zero.
            </li>
          </ul>
          <p>Verdict: 80+ strong fit, 60–79 moderate, 40–59 weak, below 40 no fit.</p>
        </Section>

        <Section title="5. Why the brand itself is left out">
          <p>
            A creator who mentions the brand would otherwise be scored against the brand’s own audience, which likes the brand by definition: the
            score would rise by construction. So the brand never counts as the creator’s evidence, is left out of the signal that finds related
            entities, and Qloo is told to exclude it from those results (<code className="text-sm">filter.exclude.entities</code>). The mention is
            reported instead.
          </p>
        </Section>

        <Section title="6. Confidence">
          <p>Confidence counts evidence; it isn’t a probability.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>High</strong>: {HIGH_CONFIDENCE_ENTITIES}+ entities named in the videos and data in all five dimensions.
            </li>
            <li>
              <strong>Medium</strong>: {MEDIUM_CONFIDENCE_ENTITIES}–{HIGH_CONFIDENCE_ENTITIES - 1} named entities.
            </li>
            <li>
              <strong>Low</strong>: fewer than {MEDIUM_CONFIDENCE_ENTITIES}: the score is indicative only.
            </li>
            <li>One level lower when the brand side is approximated (reference brands, a description, style tags or a key visual).</li>
            <li>At most Medium in Find creators, where the evidence is the audience’s inferred taste, not what the creator says.</li>
          </ul>
        </Section>

        <Section title="7. When there is no score">
          <p>
            Fewer than {MIN_DIRECT_ENTITIES} entities from the videos that Qloo confirms and scores, no language model to propose names, or a brand
            side that can’t be built from Qloo: CreatorPulse says “insufficient data”, names the cause and the next step, and gives no number.
          </p>
        </Section>

        <Section title="8. What the language model does, and doesn’t">
          <p>
            Gemini (or Groq as a fallback) reads video titles and descriptions and proposes names they explicitly mention. Those are search terms
            only: a name becomes evidence only if Qloo has an entity with exactly that name or alias. The model never sees or produces a score.
          </p>
        </Section>

        <Section title="9. Filters and checks">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Entities related by Qloo need a Qloo popularity of at least {EXPANSION_POPULARITY_MIN} (
              <code className="text-sm">filter.popularity.min</code>); the scoring call itself has no popularity filter.
            </li>
            <li>
              Every entity confirmed by search is re-checked against Qloo’s own record (<code className="text-sm">/entities</code>).
            </li>
            <li>
              Qloo’s tag comparison (<code className="text-sm">/v2/analysis/compare</code>) is shown beside the score as a cross-check; it never
              changes it.
            </li>
            <li>Find creators rankings for the demo brands are checked against an obvious fit and an obvious misfit before being presented.</li>
          </ul>
        </Section>

        <p className="border-t border-slate-200 pt-6 text-sm text-slate-500">
          Every call and decision of a run is listed in its Agent Trace.{' '}
          <Link href="/" className="font-medium text-teal-700 hover:underline">
            Run the demo
          </Link>
        </p>
      </main>
    </>
  );
}
