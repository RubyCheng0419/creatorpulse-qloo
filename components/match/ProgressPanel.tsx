import { Button } from '@/components/ui/button';
import { STAGES, type MatchStage } from '@/lib/stages';

const TARGET_SECONDS = 20;

export function ProgressPanel({
  title,
  done,
  elapsed,
  onCancel,
}: {
  title: string;
  done: MatchStage[];
  elapsed: number;
  onCancel: () => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6" aria-live="polite">
      <h2 className="text-lg font-semibold text-slate-900">Analyzing {title}</h2>
      <ol className="mt-4 space-y-3">
        {STAGES.map((s, i) => {
          const isDone = done.includes(s.id);
          return (
            <li key={s.id} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                  isDone ? 'bg-teal-600 text-white' : 'animate-pulse bg-slate-200 text-slate-500'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </span>
              <span className={isDone ? 'text-slate-900' : 'text-slate-500'}>{s.label}</span>
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
