'use client';

import { useState } from 'react';
import { STAGE_LABELS, isLlm, llmName, summarizeTrace, type TraceStage, type TraceStep } from '@/lib/trace';

const STAGE_ORDER: TraceStage[] = ['youtube', 'creator', 'brand', 'expand', 'score', 'report'];

function toolStyle(tool: string): string {
  if (tool.startsWith('YouTube')) return 'bg-rose-50 text-rose-800 ring-rose-200';
  if (isLlm(tool)) return 'bg-violet-50 text-violet-800 ring-violet-200';
  if (tool.startsWith('Qloo')) return 'bg-teal-50 text-teal-800 ring-teal-200';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

function Step({ s }: { s: TraceStep }) {
  const external = s.tool !== 'Rule';
  return (
    <li className="py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ${toolStyle(s.tool)}`}>{s.tool === 'Rule' ? 'Decision' : s.tool}</span>
        {!s.ok && <span className="rounded bg-rose-600 px-1.5 py-0.5 text-xs font-medium text-white">failed</span>}
        {external && s.ok && s.cached !== undefined && (
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${s.cached ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}
            title={s.cached ? 'Answer reused from this server’s cache (see the note at the top)' : 'Fetched live during this match'}
          >
            {isLlm(s.tool) ? `${llmName(s.tool)} ` : ''}
            {s.cached ? 'cached' : 'live'}
          </span>
        )}
        {/* Qloo HTTP attempts; anything other than a plain 200 is highlighted. */}
        {s.http && s.http !== 'cache' && (
          <span
            className={`rounded px-1.5 py-0.5 text-xs tabular-nums ${s.http === '200' ? 'text-slate-500' : 'bg-orange-100 font-medium text-orange-900'}`}
            title="HTTP status of each attempt"
          >
            HTTP {s.http}
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums text-slate-400">
          {s.ms !== undefined && `${s.ms} ms · `}t+{(s.t / 1000).toFixed(1)}s
        </span>
      </div>
      <p className="mt-1 text-slate-600">{s.input}</p>
      <p className="mt-0.5 break-words text-slate-900">→ {s.output}</p>
      {s.decision && <p className="mt-0.5 font-medium text-slate-800">Decision: {s.decision}</p>}
    </li>
  );
}

// Every tool call and decision behind this result, grouped by stage.
export function AgentTrace({
  steps,
  liveRun,
  onRunLive,
  running,
}: {
  steps: TraceStep[];
  liveRun?: boolean;
  onRunLive?: () => void;
  running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const sum = summarizeTrace(steps);
  const total = Math.max(...steps.map((s) => s.t));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Agent Trace</h3>
          <p className="mt-1 text-sm text-slate-600">
            {sum.youtube} YouTube call{sum.youtube === 1 ? '' : 's'} · {sum.llm} LLM call{sum.llm === 1 ? '' : 's'} ({sum.llm - sum.llmCached} live, {sum.llmCached} from cache) ·{' '}
            {sum.qlooLive + sum.qlooCached} Qloo calls ({sum.qlooLive} live, {sum.qlooCached} from cache) · {sum.decisions} decisions ·{' '}
            {(total / 1000).toFixed(1)}s
          </p>
          <p className="mt-1 text-xs text-slate-500">
            First run is live. Re-runs reuse cache: Qloo up to 1h, YouTube and the LLM (Gemini, or Groq as fallback) up to 24h for the same set of videos. “Run live”
            bypasses every cache.
          </p>
          <p className={`mt-2 inline-block rounded px-2 py-0.5 text-xs font-medium ${liveRun ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}>
            {liveRun
              ? 'This run: live. Every Qloo, YouTube and LLM call bypassed the cache.'
              : `This run: cache allowed. ${sum.extraction ? `${llmName(sum.extraction.tool)} ${sum.extraction.cached ? 'cached' : 'live'}; ` : ''}${sum.qlooCached} of ${sum.qlooLive + sum.qlooCached} Qloo calls came from cache.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onRunLive && (
            <button
              type="button"
              onClick={onRunLive}
              disabled={running}
              className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              title="Re-run this match with every Qloo, YouTube and LLM call fetched live"
            >
              {running ? 'Running live…' : 'Run live'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            {open ? 'Hide steps' : `Show all ${steps.length} steps`}
          </button>
        </div>
      </div>

      {open && (
        <ol className="mt-4 space-y-4">
          {STAGE_ORDER.map((stage) => {
            const group = steps.filter((s) => s.stage === stage).sort((a, b) => a.t - b.t);
            if (!group.length) return null;
            return (
              <li key={stage}>
                <h4 className="text-xs font-semibold tracking-wide text-slate-500">
                  {STAGE_LABELS[stage]} ({group.length})
                </h4>
                <ul className="divide-y divide-slate-100">
                  {group.map((s, i) => (
                    <Step key={i} s={s} />
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
