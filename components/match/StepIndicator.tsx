const STEPS = ['Creator', 'Brand', 'Analysis', 'Result'];

export function StepIndicator({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="flex items-center gap-2 text-sm print:hidden" aria-label="Progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'todo';
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                state === 'todo' ? 'bg-slate-100 text-slate-400' : 'bg-teal-600 text-white'
              }`}
            >
              {state === 'done' ? '✓' : n}
            </span>
            <span className={`hidden sm:inline ${state === 'current' ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{label}</span>
            {n < STEPS.length && <span className={`h-px flex-1 ${n < current ? 'bg-teal-600' : 'bg-slate-200'}`} />}
          </li>
        );
      })}
    </ol>
  );
}
