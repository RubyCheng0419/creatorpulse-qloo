'use client';

import { useEffect } from 'react';
import type { Match } from '@/lib/match';
import { Button } from '@/components/ui/button';
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

export function MatchResult({ match, onReset, autoPrint }: { match: Match; onReset?: () => void; autoPrint?: boolean }) {
  useEffect(() => {
    if (autoPrint) printMatch(match);
  }, [autoPrint, match]);

  return (
    <div className="space-y-4">
      <ScoreCard match={match} />

      {match.status === 'completed' && match.report ? (
        <>
          <TasteComparison dimensions={match.compatibility.dimensions} />
          <ReportDetails report={match.report} />
        </>
      ) : (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <h3 className="text-base font-semibold">Insufficient data: no score</h3>
          <p className="mt-2">{match.errorMessage}</p>
          <p className="mt-2 text-amber-800">We would rather give no score than one without Qloo evidence. Try videos that name more brands, works or people, or the brand’s full English name.</p>
        </section>
      )}

      <SourcesPanel match={match} />

      <p className="text-xs text-slate-500">{DISCLAIMER}</p>

      <div className="flex flex-wrap gap-3 print:hidden">
        {match.status === 'completed' && (
          <Button size="lg" onClick={() => printMatch(match)}>
            Download PDF report
          </Button>
        )}
        {onReset && (
          <Button size="lg" variant="outline" onClick={onReset}>
            Run another match
          </Button>
        )}
      </div>
      {match.status === 'completed' && (
        <p className="text-xs text-slate-500 print:hidden">Opens the print dialog: choose “Save as PDF” as the destination.</p>
      )}
    </div>
  );
}
