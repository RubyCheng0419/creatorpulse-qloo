import { Check, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { STAGES, type MatchStage } from '@/lib/stages';

const TARGET_SECONDS = 20;
const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

// The server reports each stage as it finishes (streamed); the browser stamps the time.
// Stages can finish out of order (the brand lookup runs alongside the videos), so "in
// progress" is the first one not done yet, and each done stage shows when it finished and
// how long since the previous one finished.
export function ProgressPanel({
  title,
  done,
  doneAt,
  elapsed,
  onCancel,
}: {
  title: string;
  done: MatchStage[];
  doneAt: Partial<Record<MatchStage, number>>; // ms since the request started
  elapsed: number;
  onCancel: () => void;
}) {
  const current = STAGES.find((st) => !done.includes(st.id));
  const finished = [...done].map((id) => doneAt[id] ?? 0).sort((a, b) => a - b);
  const pct = Math.round((done.length / STAGES.length) * 100);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-live="polite">
      <h2 className="text-lg font-semibold text-slate-900">Analyzing {title}</h2>
      <div className="mt-4 flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={STAGES.length}
          aria-valuenow={done.length}
          aria-label="Analysis progress"
        >
          <div className="h-full rounded-full bg-teal-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs tabular-nums text-slate-500">
          {done.length}/{STAGES.length}
        </span>
      </div>
      {current && (
        <p className="mt-2 text-sm text-slate-700">
          <span className="font-medium">Now:</span> {current.label}
        </p>
      )}
      <ol className="mt-4 space-y-3">
        {STAGES.map((st, i) => {
          const at = doneAt[st.id];
          const isDone = done.includes(st.id);
          const isCurrent = st.id === current?.id;
          const before = at !== undefined ? finished.filter((t) => t < at).pop() ?? 0 : 0;
          return (
            <li key={st.id} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                  isDone ? 'bg-teal-600 text-white' : isCurrent ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-200' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {isDone ? <Check aria-hidden className="size-3.5" /> : isCurrent ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : i + 1}
              </span>
              <span className={`flex-1 ${isDone ? 'text-slate-900' : isCurrent ? 'font-medium text-slate-900' : 'text-slate-500'}`}>{st.label}</span>
              {isDone && at !== undefined && (
                <span className="text-xs tabular-nums text-slate-500">
                  {s(at)} <span className="text-slate-400">(+{s(at - before)})</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-5 text-sm tabular-nums text-slate-500">
        {elapsed}s elapsed (target: under {TARGET_SECONDS}s)
      </p>
      {elapsed > TARGET_SECONDS && <p className="mt-1 text-sm font-medium text-amber-800">Qloo is responding slowly. Please wait.</p>}
      <Button variant="outline" className="mt-4" onClick={onCancel}>
        Cancel and go back
      </Button>
    </section>
  );
}
