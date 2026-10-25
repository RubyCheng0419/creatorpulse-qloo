import type { Match } from '@/lib/match';

// The start of the evidence chain: which videos were read, which names were proposed,
// and which of them Qloo confirmed as entities.
export function SourcesPanel({ match }: { match: Match }) {
  const c = match.creator;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 text-sm print:break-inside-avoid print:p-4">
      <h3 className="text-base font-semibold text-slate-900">Sources</h3>
      <div className="mt-3 grid gap-5 sm:grid-cols-2 print:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-slate-500">Videos read ({c.videos.length})</h4>
          <ul className="mt-1 space-y-1 text-slate-700">
            {c.videos.map((v) => (
              <li key={v.videoId}>
                <a href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noreferrer" className="hover:text-teal-700 hover:underline">
                  {v.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-slate-500">
            Name extraction:{' '}
            {c.keywordSource === 'gemini'
              ? 'Gemini (proposes search terms only; Qloo confirms)'
              : 'unavailable (Gemini failed, so no names were extracted)'}
          </h4>
          {c.keywordSource === 'gemini' && c.geminiCached !== undefined && (
            <p className="mt-1">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${c.geminiCached ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}
              >
                {c.geminiCached ? 'Gemini cached' : 'Gemini live'}
              </span>
              <span className="ml-2 text-xs text-slate-500">
                {c.geminiCached
                  ? `Reused the extraction for these videos from ${c.geminiAt ? new Date(c.geminiAt).toLocaleString('en-US') : 'earlier'} (cached 24h).`
                  : 'Extracted during this run.'}
              </span>
            </p>
          )}
          <p className="mt-1 text-slate-700">
            <span className="text-slate-500">Confirmed by Qloo ({c.entities.length}): </span>
            {c.entities.length ? c.entities.map((e) => (e.name === e.query ? e.name : `${e.name} (“${e.query}”)`)).join(', ') : 'none'}
          </p>
          {c.unmatched.length > 0 && (
            <p className="mt-1 text-slate-500">
              Not found in Qloo, not scored: {c.unmatched.join(', ')}
            </p>
          )}
        </div>
      </div>
      {match.warnings.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-amber-800 print:hidden">
          {match.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
