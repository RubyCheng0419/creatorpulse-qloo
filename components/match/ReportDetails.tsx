import { type DecisionSummary, HOLD_RECOMMENDATION, type Report } from '@/lib/report';

// `decision` is rebuilt from the scores (lib/report decisionSummary), so a result saved before
// the decision summary existed shows it too; without one, the stored summary text is shown.
// A Hold gives no content recommendations, whatever the stored report says.
export function ReportDetails({ report, decision }: { report: Report; decision: DecisionSummary | null }) {
  const recommendations = decision?.verdict === 'Hold' ? [HOLD_RECOMMENDATION] : report.recommendations;
  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 print:p-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Summary</h3>
        {decision ? (
          <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm leading-relaxed text-slate-700 sm:grid-cols-[7rem_1fr] print:grid-cols-[7rem_1fr]">
            <dt className="font-semibold text-slate-900">Decision</dt>
            <dd>
              <span className="font-semibold text-slate-900">{decision.verdict}:</span> {decision.condition}
            </dd>
            <dt className="font-semibold text-slate-900">Why</dt>
            <dd>{decision.why}</dd>
            <dt className="font-semibold text-slate-900">Next step</dt>
            <dd>{decision.next}</dd>
            <dt className="font-semibold text-slate-900">Confidence</dt>
            <dd>{decision.confidence}</dd>
          </dl>
        ) : (
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{report.summary}</p>
        )}
      </div>
      <div className="print:break-inside-avoid">
        <h3 className="text-base font-semibold text-slate-900">Culture Clash</h3>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-700">
          {report.cultureClash.split('\n\n').map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 print:grid-cols-2 print:break-inside-avoid">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Recommendations</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
            {recommendations.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-900">Risks</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
            {report.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
