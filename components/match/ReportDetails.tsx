import type { Report } from '@/lib/report';

export function ReportDetails({ report }: { report: Report }) {
  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 print:p-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Summary</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">{report.summary}</p>
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
            {report.recommendations.map((r) => (
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
