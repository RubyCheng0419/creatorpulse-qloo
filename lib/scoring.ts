import type { QlooEntity } from '@/lib/qloo';

// PRODUCT_SPEC v3.1 §5: the score is computed here, by fixed rules, never by an LLM.
// Same Qloo inputs → same score.

export type Dimension = 'tech' | 'entertainment' | 'music' | 'lifestyle' | 'food_travel';

export const DIMENSIONS: Dimension[] = ['tech', 'entertainment', 'music', 'lifestyle', 'food_travel'];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  tech: 'Tech & Innovation',
  entertainment: 'Film, TV & Entertainment',
  music: 'Music',
  lifestyle: 'Lifestyle & Fashion',
  food_travel: 'Food & Travel',
};

// Qloo affinities observed on 2026-10-25 sit between ~0.55 and ~0.98 (Apple's audience:
// Halt and Catch Fire 0.98, Adidas 0.87, Flying Magazine 0.69), so 100 × affinity
// would put every pair at 75–95. Affinity is rescaled linearly from [FLOOR, 1] to [0, 100].
export const AFFINITY_FLOOR = 0.5;
// Three tiers per entity, by the brand audience's affinity:
//   ≥ INTERSECTION_MIN                  shared taste
//   DIVERGENCE_MAX ≤ a < INTERSECTION_MIN weak link (related, but not strongly)
//   < DIVERGENCE_MAX                     clash (evidence of mismatch, not merely missing data)
export const INTERSECTION_MIN = 0.85;
export const DIVERGENCE_MAX = 0.7;

export const DIRECT_WEIGHT = 1; // entity named in the creator's own videos
export const PROXY_WEIGHT = 0.5; // entity Qloo associates with those, one step removed
export const MIN_DIRECT_ENTITIES = 3; // §3.2: fewer than this → no score
const CONFIDENT_DIRECT_ENTITIES = 10; // named entities needed for full marks on that part of confidence
const FULL_MARKS_DIRECT_SHARE = 0.5; // share of score weight from named entities that earns full marks

const TYPE_DIMENSION: Record<string, Dimension> = {
  'urn:entity:artist': 'music',
  'urn:entity:album': 'music',
  'urn:entity:movie': 'entertainment',
  'urn:entity:tv_show': 'entertainment',
  'urn:entity:podcast': 'entertainment',
  'urn:entity:videogame': 'entertainment',
  'urn:entity:book': 'entertainment',
  'urn:entity:person': 'entertainment',
  'urn:entity:destination': 'food_travel',
  'urn:entity:place': 'food_travel',
};

// Brands are split by the top segment of their Qloo genre tags ("brand:electronics:…").
const BRAND_GENRE_DIMENSION: Record<string, Dimension> = {
  electronics: 'tech',
  software: 'tech',
  automotive: 'tech',
  technology: 'tech',
  telecommunications: 'tech',
  internet: 'tech',
  entertainment: 'entertainment',
  media: 'entertainment',
  gaming: 'entertainment',
  sports_organization: 'entertainment',
  food_and_beverage: 'food_travel',
  dining: 'food_travel',
  travel: 'food_travel',
  fashion: 'lifestyle',
  health_and_beauty: 'lifestyle',
  home: 'lifestyle',
};

export function dimensionOf(entity: QlooEntity): Dimension {
  if (TYPE_DIMENSION[entity.type]) return TYPE_DIMENSION[entity.type];
  // Brands: majority vote over genre tags; generic tags like mobile_app and retail don't vote.
  const votes = new Map<Dimension, number>();
  for (const g of entity.genres) {
    const [kind, top] = g.split(':');
    const d = kind === 'brand' ? BRAND_GENRE_DIMENSION[top] : undefined;
    if (d) votes.set(d, (votes.get(d) || 0) + 1);
  }
  const winner = [...votes].sort((a, b) => b[1] - a[1] || DIMENSIONS.indexOf(a[0]) - DIMENSIONS.indexOf(b[0]))[0];
  return winner ? winner[0] : 'lifestyle';
}

export interface ScoredEntity extends QlooEntity {
  side: 'direct' | 'proxy';
  weight: number;
  brandAffinity: number; // Qloo affinity of this entity given the brand as signal
  dimension: Dimension;
}

export interface DimensionScore {
  dimension: Dimension;
  label: string;
  score: number | null; // null = no data; excluded from the total, not counted as 0
  weight: number; // share of the total after redistribution
  itemCount: number;
  intersection: ScoredEntity[]; // shared taste
  weakLink: ScoredEntity[];
  divergence: ScoredEntity[]; // clash
}

export type Verdict = 'high' | 'medium' | 'low' | 'no-match' | 'insufficient-data';

export interface Compatibility {
  fitScore: number | null;
  confidence: number | null;
  // Each part 0–1: named entities scored (of 10), dimensions with data (of 5),
  // share of the score's weight that comes from named entities.
  confidenceBasis?: { directEntities: number; coverage: number; directShare: number };
  verdict: Verdict;
  dimensions: DimensionScore[];
}

const points = (a: number) => Math.min(100, Math.max(0, ((a - AFFINITY_FLOOR) / (1 - AFFINITY_FLOOR)) * 100));

export function verdictOf(fit: number): Verdict {
  if (fit >= 80) return 'high';
  if (fit >= 60) return 'medium';
  if (fit >= 40) return 'low';
  return 'no-match';
}

export function computeCompatibility(items: ScoredEntity[]): Compatibility {
  const dimensions: DimensionScore[] = DIMENSIONS.map((dimension) => {
    const group = items.filter((i) => i.dimension === dimension);
    const totalWeight = group.reduce((s, i) => s + i.weight, 0);
    // Low-affinity entities already pull the weighted mean down, so divergence gets
    // no separate penalty (that would count the same evidence twice).
    const score = totalWeight ? Math.round(group.reduce((s, i) => s + i.weight * points(i.brandAffinity), 0) / totalWeight) : null;
    return {
      dimension,
      label: DIMENSION_LABELS[dimension],
      score,
      weight: 0,
      itemCount: group.length,
      intersection: group.filter((i) => i.brandAffinity >= INTERSECTION_MIN).sort((a, b) => b.brandAffinity - a.brandAffinity),
      weakLink: group
        .filter((i) => i.brandAffinity >= DIVERGENCE_MAX && i.brandAffinity < INTERSECTION_MIN)
        .sort((a, b) => b.brandAffinity - a.brandAffinity),
      divergence: group.filter((i) => i.brandAffinity < DIVERGENCE_MAX).sort((a, b) => a.brandAffinity - b.brandAffinity),
    };
  });

  // Equal weights (0.2 each), redistributed over the dimensions that have data.
  const scored = dimensions.filter((d) => d.score !== null);
  for (const d of scored) d.weight = 1 / scored.length;
  if (!scored.length) return { fitScore: null, confidence: null, verdict: 'insufficient-data', dimensions };

  const fitScore = Math.round(scored.reduce((s, d) => s + d.score! * d.weight, 0));

  // Confidence = how much of the score rests on entities the creator actually named,
  // rather than on Qloo's cross-domain inference. The first version (coverage, volume,
  // 5 direct entities) saturated at 100 for 9 of 12 brands, so it said nothing.
  // Weights are a judgement call, documented in the README.
  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  const direct = items.filter((i) => i.side === 'direct');
  const basis = {
    directEntities: Math.min(1, direct.length / CONFIDENT_DIRECT_ENTITIES),
    coverage: scored.length / DIMENSIONS.length,
    directShare: totalWeight ? direct.reduce((s, i) => s + i.weight, 0) / totalWeight : 0,
  };
  // Cross-domain entities outnumber named ones (~30 vs ~10), so even strong named evidence
  // rarely exceeds half the weight; half counts as full marks, or confidence would cap at ~76.
  const shareScore = Math.min(1, basis.directShare / FULL_MARKS_DIRECT_SHARE);
  const confidence = Math.round(100 * (0.35 * basis.directEntities + 0.25 * basis.coverage + 0.4 * shareScore));

  return { fitScore, confidence, confidenceBasis: basis, verdict: verdictOf(fitScore), dimensions };
}
