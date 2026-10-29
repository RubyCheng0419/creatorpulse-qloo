import type { NameResolution } from '@/lib/creator';
import { MIN_DIRECT_ENTITIES } from '@/lib/scoring';
import type { TraceStep } from '@/lib/trace';

// Why the videos gave no score, as exactly one cause with the counts that prove it, decided
// from what the run logged: each proposed name's fate (lib/creator NameResolution), the LLM
// that answered, and every failed call in the Agent Trace. The same object is written to the
// trace and shown on the page, so the two can't disagree. Pure; shared by server and browser.
//
// Order matters: a failed call comes first, because a name Qloo couldn't be asked about is
// missing data, not a non-match; then no names at all; then names Qloo didn't confirm; then
// only the brand itself; then too few names to reach the minimum; then too few confirmed.

export type CauseKind = 'failed-call' | 'thin-extraction' | 'qloo-no-match' | 'brand-only' | 'below-minimum';

export interface InsufficientCause {
  kind: CauseKind;
  title: string;
  detail: string;
  proposed: number; // names the LLM proposed, minus the channel itself
  confirmed: number; // distinct Qloo entities confirmed, the brand included
  brandItself: number; // of those, the brand side (never scored)
  scoreable: number; // confirmed minus the brand: what counts towards the minimum
  minimum: number;
  llm: string; // which LLM extracted the names, and why when it was the fallback
  failedCalls: string[]; // "Qloo /search “Edge 1060”: HTTP 429 → 429 (gave up after retry)"
  names: NameResolution[];
  brandIds: string[]; // the brand side's Qloo ids
}

const TITLES: Record<CauseKind, string> = {
  'failed-call': 'Failed call',
  'thin-extraction': 'Thin extraction',
  'qloo-no-match': 'Qloo no-match',
  'brand-only': 'Brand only',
  'below-minimum': 'Below minimum',
};

export function llmUsed(c: { keywordSource: string; extractionModel?: string; extractionFallback?: string; extractionError?: string }): string {
  if (c.keywordSource === 'unavailable') return `none: ${c.extractionError || 'no LLM answered'}`;
  const name = c.keywordSource === 'groq' ? 'Groq' : 'Gemini';
  return `${name}${c.extractionModel ? ` (${c.extractionModel})` : ''}${c.keywordSource === 'groq' && c.extractionFallback ? `, after Gemini failed: ${c.extractionFallback}` : ''}`;
}

// Calls that failed on the creator side: a Qloo query that got no usable answer (after its
// retry), or an LLM that didn't answer when no other one did.
export function failedCreatorCalls(trace: TraceStep[]): string[] {
  return trace
    .filter((s) => s.stage === 'creator' && s.ok === false && /^Qloo /.test(s.tool))
    .map((s) => `${s.tool} ${s.input}: HTTP ${s.http || 'no response'}`);
}

export function insufficientCause(input: {
  names: NameResolution[];
  brandIds: string[];
  keywordSource: string;
  extractionModel?: string;
  extractionFallback?: string;
  extractionError?: string;
  trace: TraceStep[];
}): InsufficientCause {
  const names = input.names;
  const proposed = names.filter((n) => n.status !== 'skipped').length;
  const ids = new Set(names.filter((n) => n.entity && ['exact', 'maker', 'alias'].includes(n.status)).map((n) => n.entity!.id));
  const brandItself = [...ids].filter((id) => input.brandIds.includes(id)).length;
  const confirmed = ids.size;
  const scoreable = confirmed - brandItself;
  const failedCalls = [...failedCreatorCalls(input.trace), ...(input.extractionError ? [`LLM name extraction: ${input.extractionError}`] : [])];
  const brandNames = names.filter((n) => n.entity && input.brandIds.includes(n.entity.id)).map((n) => n.entity!.name);
  const brand = [...new Set(brandNames)].join(', ');

  let kind: CauseKind;
  let detail: string;
  if (failedCalls.length) {
    kind = 'failed-call';
    detail = `${failedCalls.length} call${failedCalls.length === 1 ? '' : 's'} failed, so the names they were for are missing data, not a confirmed absence. Re-run in a minute.`;
  } else if (!proposed) {
    kind = 'thin-extraction';
    detail = 'The videos’ titles, descriptions and tags named nothing the LLM could propose.';
  } else if (!confirmed) {
    kind = 'qloo-no-match';
    detail = `${proposed} name${proposed === 1 ? '' : 's'} proposed, none an exact name or alias match in Qloo.`;
  } else if (!scoreable && brandItself) {
    kind = 'brand-only';
    detail = `Qloo confirmed only ${brand}, the brand being scored, which is never scored against itself. Scoreable: 0.`;
  } else if (proposed < MIN_DIRECT_ENTITIES) {
    kind = 'thin-extraction';
    detail = `Only ${proposed} name${proposed === 1 ? '' : 's'} proposed: even if Qloo confirmed all of them, ${MIN_DIRECT_ENTITIES} scoreable entities couldn’t be reached.`;
  } else {
    kind = 'below-minimum';
    detail = `${scoreable} scoreable entit${scoreable === 1 ? 'y' : 'ies'}, below the minimum of ${MIN_DIRECT_ENTITIES}.`;
  }
  return {
    kind,
    title: TITLES[kind],
    detail,
    proposed,
    confirmed,
    brandItself,
    scoreable,
    minimum: MIN_DIRECT_ENTITIES,
    llm: llmUsed(input),
    failedCalls,
    names,
    brandIds: input.brandIds,
  };
}

export const causeCounts = (c: InsufficientCause) =>
  `proposed ${c.proposed} · confirmed ${c.confirmed}${c.brandItself ? ` (${c.brandItself} the brand itself, not scored)` : ''} · scoreable ${c.scoreable} of ${c.minimum} needed`;
