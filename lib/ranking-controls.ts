import type { Compatibility } from '@/lib/scoring';

// Win/lose controls for Find creators' default ranking ("Any YouTuber"). For each demo brand,
// one creator who obviously fits and one who obviously doesn't are scored in the same request,
// with the same profile calls and the same batched scoring as the ranked creators. Chosen by
// hand on 2026-10-27; each is an exact-name Qloo person with a creator tag. Other brands and
// creator types have no controls, so their rankings are shown as not validated.
export const RANKING_CONTROLS: Record<string, { fit: string; misfit: string }> = {
  'apple inc': { fit: 'Marques Brownlee', misfit: 'Sandra Lee' }, // tech reviewer / dermatologist
  huggies: { fit: 'Cole LaBrant', misfit: 'DrLupo' }, // family vlogger / gaming streamer
  'le labo fragrances': { fit: 'Jeremy Fragrance', misfit: 'DrLupo' }, // fragrance influencer / gaming streamer
};

// "Clearly": the obvious misfit must score at least this far below the top-ranked creator.
export const CONTROL_MARGIN = 5;

export interface ControlResult {
  role: 'fit' | 'misfit';
  name: string;
  qlooId: string | null; // null: no creator-tagged Qloo person with this exact name
  fitScore: number | null;
  strongest: string | null; // "Music 81"
  weakest: string | null;
  rank: number | null; // its place in the ranking, when Qloo also ranked it
  missing: string[]; // profile types Qloo didn't answer for this control (timeouts)
}

export interface RankingValidation {
  status: 'validated' | 'unverified' | 'not-validated';
  reasons: string[];
  top: { name: string; fitScore: number } | null;
  controls: ControlResult[];
  margin: number;
  // The weakest dimension across the ranking, and whether leaving it out reorders the top 3.
  weakest: { label: string; count: number; of: number; top3: string[]; top3Without: string[] } | null;
}

const extreme = (c: Compatibility, pick: 'max' | 'min') => {
  const dims = c.dimensions.filter((d) => d.score !== null);
  if (!dims.length) return null;
  const d = [...dims].sort((a, b) => (pick === 'max' ? b.score! - a.score! : a.score! - b.score!))[0];
  return `${d.label} ${d.score}`;
};

export function controlResult(
  role: ControlResult['role'],
  name: string,
  qlooId: string | null,
  c: Compatibility | null,
  rank: number | null,
  missing: string[] = []
): ControlResult {
  return {
    role,
    name,
    qlooId,
    fitScore: c?.fitScore ?? null,
    strongest: c ? extreme(c, 'max') : null,
    weakest: c ? extreme(c, 'min') : null,
    rank,
    missing,
  };
}

// The checks, in order: both controls must be scorable; the obvious fit must be the top-ranked
// creator or score at least as high; the obvious misfit must score CONTROL_MARGIN below it.
export function validateRanking(
  ranked: { name: string; compatibility: Compatibility }[],
  controls: ControlResult[] | null
): Omit<RankingValidation, 'weakest'> {
  const first = ranked.find((c) => c.compatibility.fitScore !== null);
  const top = first ? { name: first.name, fitScore: first.compatibility.fitScore! } : null;
  if (!controls) return { status: 'not-validated', reasons: ['No win/lose controls are defined for this brand and creator type.'], top, controls: [], margin: CONTROL_MARGIN };
  const reasons: string[] = [];
  const missing = controls.filter((c) => c.fitScore === null);
  for (const c of missing)
    reasons.push(c.qlooId ? `${c.name} (obvious ${c.role}) couldn’t be scored: too little audience taste in Qloo.` : `${c.name} (obvious ${c.role}) isn’t a creator-tagged person in Qloo.`);
  if (!top) reasons.push('No creator in the ranking got a score.');
  if (missing.length || !top) return { status: 'not-validated', reasons, top, controls, margin: CONTROL_MARGIN };

  const fit = controls.find((c) => c.role === 'fit')!;
  const misfit = controls.find((c) => c.role === 'misfit')!;
  const fitOk = fit.rank === 1 || fit.fitScore! >= top.fitScore;
  const misfitOk = misfit.fitScore! <= top.fitScore - CONTROL_MARGIN;
  if (!fitOk) reasons.push(`The obvious fit, ${fit.name}, scores ${fit.fitScore}: below the top-ranked ${top.name} (${top.fitScore}).`);
  if (!misfitOk) reasons.push(`The obvious misfit, ${misfit.name}, scores ${misfit.fitScore}: not ${CONTROL_MARGIN}+ points below the top-ranked ${top.name} (${top.fitScore}).`);
  if (fitOk && misfitOk)
    reasons.push(
      `${fit.name} (obvious fit) ${fit.rank === 1 ? 'is the top-ranked creator' : `scores ${fit.fitScore}, at least the top score`}; ${misfit.name} (obvious misfit) scores ${misfit.fitScore}, ${top.fitScore - misfit.fitScore!} below the top.`
    );
  // A control scored from part of its profile can flag a ranking, but never vouch for one.
  const partial = controls.filter((c) => c.missing.length);
  for (const c of partial) reasons.push(`${c.name}’s profile is incomplete (Qloo didn’t answer for ${c.missing.join(', ')}).`);
  const status = !(fitOk && misfitOk) ? 'unverified' : partial.length ? 'not-validated' : 'validated';
  return { status, reasons, top, controls, margin: CONTROL_MARGIN };
}

// Is the same dimension the weakest for most ranked creators, and does dropping it (equal
// weights over the rest, as the formula already does for missing data) reorder the top 3?
export function weakestDimension(ranked: { name: string; compatibility: Compatibility }[]): RankingValidation['weakest'] {
  const scored = ranked.filter((c) => c.compatibility.fitScore !== null);
  if (scored.length < 3) return null;
  const counts = new Map<string, number>();
  for (const c of scored) {
    const w = extreme(c.compatibility, 'min');
    if (w) {
      const label = w.replace(/ \d+$/, '');
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  const [label, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  const without = scored
    .map((c) => {
      const rest = c.compatibility.dimensions.filter((d) => d.score !== null && d.label !== label);
      return { name: c.name, score: rest.length ? rest.reduce((s, d) => s + d.score!, 0) / rest.length : -1 };
    })
    .sort((a, b) => b.score - a.score);
  return { label, count, of: scored.length, top3: scored.slice(0, 3).map((c) => c.name), top3Without: without.slice(0, 3).map((c) => c.name) };
}
