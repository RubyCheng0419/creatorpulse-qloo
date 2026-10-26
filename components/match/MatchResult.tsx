'use client';

import { useEffect } from 'react';
import type { Match } from '@/lib/match';
import { Button } from '@/components/ui/button';
import { NO_DATA_NEXT_STEPS } from '@/lib/no-data';
import { parseVideoId } from '@/lib/youtube-url';
import { downloadMarkdown } from '@/lib/report-markdown';
import { summarizeTrace } from '@/lib/trace';
import { AgentTrace } from './AgentTrace';
import { BrandFallbackForm, type BrandFallbackInput } from './BrandFallbackForm';
import { ReportDetails } from './ReportDetails';
import { ScoreCard } from './ScoreCard';
import { SourcesPanel } from './SourcesPanel';
import { TasteComparison } from './TasteComparison';

export const DISCLAIMER =
  'Scores are based on Qloo’s taste graph and the creator’s public video metadata. No audience personal data is used. Dimensions without data are excluded from the score.';

// PDF = the browser's "Save as PDF" on this same page, so the PDF can never differ
// from what is on screen (PRODUCT_SPEC §7). The title becomes the default file name.
export function printMatch(match: Match) {
  const previous = document.title;
  const brand = match.brand.entity?.name || match.brand.name;
  const date = match.createdAt.slice(0, 10);
  document.title = `CreatorPulse_${brand}_${match.creator.channelName || 'creator'}_${date}`.replace(/[\\/:*?"<>|\s]+/g, '_');
  window.addEventListener('afterprint', () => (document.title = previous), { once: true });
  window.print();
}

export function MatchResult({
  match,
  onReset,
  onRunLive,
  onUseBrand,
  onBrandFallback,
  running,
  autoPrint,
}: {
  match: Match;
  onReset?: () => void;
  onRunLive?: () => void; // re-run this match with every Qloo and YouTube cache bypassed
  onUseBrand?: (brandName: string) => void; // re-run with a brand name the user picked
  onBrandFallback?: (fallback: BrandFallbackInput) => void; // re-run against reference brands or a description
  running?: boolean;
  autoPrint?: boolean;
}) {
  useEffect(() => {
    if (autoPrint) printMatch(match);
  }, [autoPrint, match]);
  // No brand side at all: neither the brand nor (verified) reference brands are in Qloo.
  const brandProblem = !match.brand.entity && !match.brand.basis;

  return (
    <div className="space-y-4">
      <ScoreCard match={match} />

      <div className="print:hidden">
        <div className="flex flex-wrap gap-3">
          <Button size="lg" onClick={() => printMatch(match)}>
            Download report (PDF)
          </Button>
          <Button size="lg" variant="outline" onClick={() => downloadMarkdown(match)}>
            Download as Markdown
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          PDF opens the print dialog: choose “Save as PDF”. Both include the scores, every entity with its affinity, and the Agent Trace
          summary.
        </p>
      </div>

      {match.status === 'completed' && match.report ? (
        <>
          <TasteComparison
            dimensions={match.compatibility.dimensions}
            proxyLabel={match.scoreBasis === 'audience' ? 'Audience taste in Qloo' : 'Cross-domain expansion'}
          />
          <ReportDetails report={match.report} />
        </>
      ) : (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <h3 className="text-base font-semibold">Insufficient data: no score</h3>
          <p className="mt-2">{match.errorMessage}</p>
          {/* The brand check comes first: its message would otherwise be contradicted. */}
          {brandProblem && match.brand.suggestions?.length && onUseBrand ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {match.brand.suggestions.map((s) => (
                <Button key={s} variant="outline" onClick={() => onUseBrand(s)}>
                  Use “{s}”
                </Button>
              ))}
            </div>
          ) : null}
          <p className="mt-2 text-amber-800">We would rather give no score than one without Qloo evidence.</p>
          {match.noDataReason === 'too-few-creator-entities' && (
            // What the videos gave, so the user sees how far short it fell, not just "no".
            <dl className="mt-3 space-y-1 text-amber-900">
              <div>
                <dt className="inline font-medium">Confirmed by Qloo ({match.creator.entities.length}): </dt>
                <dd className="inline">{match.creator.entities.map((e) => e.name).join(', ') || 'none'}</dd>
              </div>
              {match.creator.unmatched.length > 0 && (
                <div>
                  <dt className="inline font-medium">Not in Qloo, dropped ({match.creator.unmatched.length}): </dt>
                  <dd className="inline">{match.creator.unmatched.join(', ')}</dd>
                </div>
              )}
            </dl>
          )}
          {match.noDataReason && (
            <div className="mt-3">
              <p className="font-medium">What you can do</p>
              <ul className="mt-1 list-disc pl-5 text-amber-800">
                {nextSteps(match).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {brandProblem && onBrandFallback && (
            <BrandFallbackForm key={`${match.id}:${match.createdAt}`} match={match} onSubmit={onBrandFallback} />
          )}
        </section>
      )}

      <SourcesPanel match={match} />

      <AgentTrace steps={match.trace ?? []} liveRun={match.liveRun} onRunLive={onRunLive} running={running} />
      <PrintedTraceSummary match={match} />

      <p className="text-xs text-slate-500">{DISCLAIMER}</p>

      <div className="flex flex-wrap gap-3 print:hidden">
        {onReset && (
          <Button size="lg" variant="outline" onClick={onReset}>
            Run another match
          </Button>
        )}
      </div>
    </div>
  );
}

// A channel was already read in full, so "paste the channel URL" would send the user in a
// circle; its audience-taste score in Find creators needs no named entities at all.
function nextSteps(match: Match): string[] {
  const steps = NO_DATA_NEXT_STEPS[match.noDataReason!];
  const fromChannel = match.creator.videoUrls.length === 1 && !parseVideoId(match.creator.videoUrls[0]);
  if (match.noDataReason !== 'too-few-creator-entities' || !fromChannel) return steps;
  return [
    'This channel’s latest videos name too few brands, works or people that Qloo knows.',
    'Find creators scores creators from their audience’s taste in Qloo, which doesn’t depend on what the videos name.',
  ];
}

// The interactive trace is screen-only; the printed report gets its summary and decisions.
function PrintedTraceSummary({ match }: { match: Match }) {
  const steps = match.trace ?? [];
  if (!steps.length) return null;
  const sum = summarizeTrace(steps);
  return (
    <section className="hidden rounded-xl border border-slate-200 p-4 text-sm print:block print:break-inside-avoid">
      <h3 className="text-base font-semibold text-slate-900">Agent Trace summary</h3>
      <p className="mt-1 text-slate-600">
        {sum.youtube} YouTube calls · {sum.llm} LLM call{sum.llm === 1 ? '' : 's'} · {sum.qlooLive + sum.qlooCached} Qloo calls ({sum.qlooLive}{' '}
        live, {sum.qlooCached} from cache) · {sum.decisions} decisions{match.liveRun ? ' · live run' : ''}
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-slate-700">
        {steps
          .filter((s) => s.tool === 'Rule')
          .map((s, i) => (
            <li key={i}>
              {s.output}
              {s.decision ? ` → ${s.decision}` : ''}
            </li>
          ))}
      </ul>
    </section>
  );
}
