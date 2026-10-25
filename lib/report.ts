import { Compatibility, DIVERGENCE_MAX, INTERSECTION_MIN, ScoredEntity, Verdict } from '@/lib/scoring';

// PRODUCT_SPEC v3.1 §6 step 4 / §7. Template-based: every sentence is assembled
// from scored Qloo entities, so each claim maps to the evidence chain in
// compatibility.dimensions. No LLM writes or edits this text.

export interface Report {
  summary: string;
  cultureClash: string;
  recommendations: string[];
  risks: string[];
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  high: 'Strong fit',
  medium: 'Moderate fit',
  low: 'Weak fit',
  'no-match': 'No fit',
  'insufficient-data': 'Insufficient data',
};

const fmt = (a: number) => a.toFixed(2);
const quote = (names: string[]) => names.map((n) => `“${n}”`).join(', ');

export function buildReport(
  brand: string,
  creator: string,
  c: Compatibility,
  items: ScoredEntity[],
  shared: ScoredEntity[],
  mentionsBrand: boolean
): Report {
  const scored = c.dimensions.filter((d) => d.score !== null);
  const missing = c.dimensions.filter((d) => d.score === null);
  const byScore = [...scored].sort((a, b) => b.score! - a.score!);
  const best = byScore[0];
  const worst = byScore[byScore.length - 1];
  const labelOf = (e: ScoredEntity) => c.dimensions.find((d) => d.dimension === e.dimension)!.label;

  const summary =
    `${brand} × ${creator}: Fit Score ${c.fitScore} (${VERDICT_LABELS[c.verdict]}), ${c.confidence} confidence` +
    (c.confidence === 'Low' ? ' (low confidence, indicative only)' : '') +
    `. Strongest dimension: ${best.label} (${best.score})` +
    (worst !== best ? `; weakest: ${worst.label} (${worst.score}).` : '.') +
    (mentionsBrand ? ` The creator's videos already mention ${brand} directly (not scored, to avoid rating the brand against itself).` : '');

  const clash = scored
    .filter((d) => d.divergence.length)
    .map(
      (d) =>
        `${d.label}: ${d.divergence
          .slice(0, 3)
          .map((e) => `${e.name} (affinity ${fmt(e.brandAffinity)})`)
          .join(', ')} relate${d.divergence.length === 1 ? 's' : ''} weakly to ${brand}'s audience (below ${DIVERGENCE_MAX}).`
    );
  if (!clash.length) clash.push(`No evidence of conflicting taste: every scored entity has affinity of at least ${DIVERGENCE_MAX}.`);
  if (missing.length) {
    clash.push(
      `${missing.map((d) => d.label).join(', ')}: no scorable Qloo data, excluded from the score. Missing data is not evidence of a clash.`
    );
  }

  const strongest = items.filter((e) => e.brandAffinity >= INTERSECTION_MIN).sort((a, b) => b.brandAffinity - a.brandAffinity);
  const recommendations: string[] = [];
  if (shared.length) {
    recommendations.push(
      `${quote(shared.map((e) => e.name))} appear both in the creator's taste graph and among ${brand}'s Qloo cultural proxies: the most direct angle for a collaboration.`
    );
  }
  for (const e of strongest.filter((e) => !shared.includes(e))) {
    if (recommendations.length >= 3) break;
    recommendations.push(`Build content around “${e.name}” (${labelOf(e)}, affinity ${fmt(e.brandAffinity)}); ${brand}'s audience relates to it strongly.`);
  }
  if (!recommendations.length) {
    recommendations.push(`No shared taste entity reaches affinity ${INTERSECTION_MIN}; taste fit should not be the basis for this collaboration.`);
  }

  const risks: string[] = items
    .filter((e) => e.brandAffinity < DIVERGENCE_MAX)
    .sort((a, b) => a.brandAffinity - b.brandAffinity)
    .slice(0, 2)
    .map((e) => `Avoid “${e.name}” as a collaboration theme (${labelOf(e)}, affinity ${fmt(e.brandAffinity)}).`);
  if (c.confidence === 'Low') risks.push('Confidence is low (fewer than 5 named entities scored); treat the result as indicative.');
  const direct = items.filter((e) => e.side === 'direct').length;
  if (direct < 5) risks.push(`Only ${direct} entities named in the creator's videos were scored; the sample is small.`);
  if (!risks.length) risks.push('No evidence-backed risks found.');

  return { summary, cultureClash: clash.join('\n\n'), recommendations, risks: risks.slice(0, 3) };
}
