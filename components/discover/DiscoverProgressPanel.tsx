import { Check, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DISCOVER_STAGES, type DiscoverProgress, type DiscoverStage } from '@/lib/stages';

const TYPICAL = '20–40 seconds';
const SLOW_SECONDS = 40;

// Where each finished step leaves the bar. Reading the creators' audience taste is most of the
// wait, so it fills its own span creator by creator.
const BAR: Record<DiscoverStage, number> = { brand: 10, candidates: 20, profiles: 80, score: 90, channels: 100 };

// Find creators while it runs: the server streams each step as it finishes (lib/stages).
export function DiscoverProgressPanel({
  brandName,
  progress,
  elapsed,
  onCancel,
}: {
  brandName: string;
  progress: DiscoverProgress[]; // in the order received
  elapsed: number;
  onCancel: () => void;
}) {
  const finishedIds = new Set(progress.filter((p) => p.finished).map((p) => p.stage));
  const isDone = (id: DiscoverStage) => finishedIds.has(id);
  const profiles = [...progress].reverse().find((p) => p.stage === 'profiles');
  const candidates = progress.find((p) => p.stage === 'candidates')?.done;
  const current = DISCOVER_STAGES.find((st) => !isDone(st.id));
  const finished = DISCOVER_STAGES.filter((st) => isDone(st.id));
  let pct = finished.length ? BAR[finished[finished.length - 1].id] : 0;
  if (current?.id === 'profiles' && profiles?.of) pct = BAR.candidates + ((BAR.profiles - BAR.candidates) * (profiles.done ?? 0)) / profiles.of;

  const detail = (id: DiscoverStage) => {
    if (id === 'candidates' && candidates !== undefined) return `${candidates} found`;
    if (id === 'profiles' && profiles?.of) return `${profiles.done ?? 0} / ${profiles.of} creators`;
    return null;
  };

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-live="polite">
      <h2 className="text-lg font-semibold text-slate-900">Finding creators for {brandName}</h2>
      <div className="mt-4 flex items-center gap-3">
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-label="Progress"
        >
          <div className="h-full rounded-full bg-teal-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-10 text-right text-xs tabular-nums text-slate-500">{Math.round(pct)}%</span>
      </div>
      {current && (
        <p className="mt-2 text-sm text-slate-700">
          <span className="font-medium">Now:</span> {current.label}
          {detail(current.id) ? ` (${detail(current.id)})` : ''}
        </p>
      )}
      <ol className="mt-4 space-y-3">
        {DISCOVER_STAGES.map((st, i) => {
          const done = isDone(st.id);
          const now = st.id === current?.id;
          return (
            <li key={st.id} className="flex items-center gap-3 text-sm">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${
                  done ? 'bg-teal-600 text-white' : now ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-200' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {done ? <Check aria-hidden className="size-3.5" /> : now ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : i + 1}
              </span>
              <span className={`flex-1 ${done ? 'text-slate-900' : now ? 'font-medium text-slate-900' : 'text-slate-500'}`}>{st.label}</span>
              {detail(st.id) && (done || now) && <span className="text-xs tabular-nums text-slate-500">{detail(st.id)}</span>}
            </li>
          );
        })}
      </ol>
      <p className="mt-5 text-sm tabular-nums text-slate-500">
        {elapsed}s elapsed (usually {TYPICAL}: Qloo reads six kinds of taste for every creator)
      </p>
      {elapsed > SLOW_SECONDS && <p className="mt-1 text-sm font-medium text-amber-800">Qloo is responding slowly. A creator whose taste doesn’t arrive in time is reported, not dropped.</p>}
      <Button variant="outline" className="mt-4" onClick={onCancel}>
        Cancel
      </Button>
    </section>
  );
}
