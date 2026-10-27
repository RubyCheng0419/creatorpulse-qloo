import { findDemoPair } from '@/lib/demo-pair';
import type { Match } from '@/lib/match';
import { parseVideoId } from '@/lib/youtube-url';

// How the videos were chosen: the latest uploads of a channel URL, the user's own picks,
// or the demo's five (the latest five when the pair was chosen, docs/DEMO_PAIR.md).
function selection(match: Match): string {
  const urls = match.creator.videoUrls;
  if (findDemoPair(urls, match.brand.name)) return 'The channel’s 5 most recent uploads when the demo pair was chosen (Oct 25, 2026); fixed since.';
  if (urls.length === 1 && !parseVideoId(urls[0])) return `The channel’s ${match.creator.videos.length} most recent uploads at the time of this run.`;
  return `Selected by the user (${urls.length} video${urls.length === 1 ? '' : 's'}), not necessarily the latest.`;
}

// The start of the evidence chain: which videos were read, which names were proposed,
// and which of them Qloo confirmed as entities.
export function SourcesPanel({ match }: { match: Match }) {
  const c = match.creator;
  const llm = c.keywordSource === 'groq' ? 'Groq' : 'Gemini';

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 text-sm print:break-inside-avoid print:p-4">
      <h3 className="text-base font-semibold text-slate-900">Sources</h3>
      <div className="mt-3 grid gap-5 sm:grid-cols-2 print:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-slate-500">Videos read ({c.videos.length})</h4>
          <p className="mt-0.5 text-xs text-slate-500">{selection(match)}</p>
          <ul className="mt-1 space-y-1.5 text-slate-700">
            {c.videos.map((v) => (
              <li key={v.videoId}>
                <a href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noreferrer" className="hover:text-teal-700 hover:underline">
                  {v.title}
                </a>
                {(v.publishedAt || typeof v.viewCount === 'number') && (
                  <span className="block text-xs tabular-nums text-slate-500">
                    {v.publishedAt && `Published ${new Date(v.publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`}
                    {v.publishedAt && typeof v.viewCount === 'number' && ' · '}
                    {typeof v.viewCount === 'number' && `${v.viewCount.toLocaleString('en-US')} views`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold tracking-wide text-slate-500">
            Name extraction:{' '}
            {c.keywordSource === 'gemini'
              ? 'Gemini (proposes search terms only; Qloo confirms)'
              : c.keywordSource === 'groq'
                ? `Groq${c.extractionModel ? ` (${c.extractionModel})` : ''}, the fallback LLM (proposes search terms only; Qloo confirms)`
                : 'unavailable (no LLM answered, so no names were extracted)'}
          </h4>
          {c.keywordSource === 'groq' && (
            // Why Gemini didn't answer stays in the Agent Trace; the result page only says what it means.
            <p className="mt-1 text-xs text-slate-500">Name extraction completed by the fallback model; scoring logic unchanged.</p>
          )}
          {c.keywordSource !== 'unavailable' && c.geminiCached !== undefined && (
            <p className="mt-1">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${c.geminiCached ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}
              >
                {llm} {c.geminiCached ? 'cached' : 'live'}
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
