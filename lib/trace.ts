// Agent Trace: every tool call and decision made while computing one match, in the
// order they finished. Recorded by the server, shown on the result page. Pure data,
// shared by the server and the browser.

export type TraceStage = 'youtube' | 'creator' | 'brand' | 'expand' | 'score' | 'report';

export interface TraceStep {
  t: number; // ms since the match started, when this step finished
  stage: TraceStage;
  tool: string; // e.g. "YouTube videos.list", "Gemini", "Qloo /search", "Rule"
  input: string;
  output: string;
  decision?: string;
  ms?: number; // duration of the call
  cached?: boolean; // Qloo, YouTube or Gemini response served from this server's cache
  ok: boolean;
}

export class Trace {
  readonly steps: TraceStep[] = [];
  private readonly start = Date.now();

  add(step: Omit<TraceStep, 't' | 'ok'> & { ok?: boolean }): void {
    this.steps.push({ ...step, ok: step.ok ?? true, t: Date.now() - this.start });
  }

  // Runs a call, then records it with its duration. `describe` turns the result
  // into the step; failures are recorded too and rethrown.
  async call<T>(
    base: Pick<TraceStep, 'stage' | 'tool' | 'input'>,
    fn: () => Promise<T>,
    describe: (r: T) => Pick<TraceStep, 'output'> & Partial<Pick<TraceStep, 'decision' | 'cached' | 'ok'>>
  ): Promise<T> {
    const t0 = Date.now();
    try {
      const r = await fn();
      this.add({ ...base, ...describe(r), ms: Date.now() - t0 });
      return r;
    } catch (e: any) {
      this.add({ ...base, output: `Failed: ${e?.message || e}`, ms: Date.now() - t0, ok: false });
      throw e;
    }
  }
}

export const STAGE_LABELS: Record<TraceStage, string> = {
  youtube: 'Read the videos',
  creator: 'Resolve the creator’s taste',
  brand: 'Resolve the brand',
  expand: 'Expand across domains',
  score: 'Score',
  report: 'Report',
};

export function summarizeTrace(steps: TraceStep[]) {
  const qloo = steps.filter((s) => s.tool.startsWith('Qloo'));
  return {
    youtube: steps.filter((s) => s.tool.startsWith('YouTube')).length,
    gemini: steps.filter((s) => s.tool.startsWith('Gemini')).length,
    geminiCached: steps.filter((s) => s.tool.startsWith('Gemini') && s.cached).length,
    qlooLive: qloo.filter((s) => !s.cached).length,
    qlooCached: qloo.filter((s) => s.cached).length,
    decisions: steps.filter((s) => s.tool === 'Rule').length,
  };
}
