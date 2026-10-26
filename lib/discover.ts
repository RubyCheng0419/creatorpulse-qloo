import { createHash } from 'node:crypto';
import { approximation, brandConfidence, lookupBrand } from '@/lib/brand';
import { CREATOR_CATEGORIES, CreatorCategory, isCreatorCategory } from '@/lib/creator-categories';
import { ApiError } from '@/lib/errors';
import type { Match } from '@/lib/match';
import type { NoDataReason } from '@/lib/no-data';
import { PROXY_TYPES, QlooEntity, getInsights, scoreEntities } from '@/lib/qloo';
import { bypassCache } from '@/lib/request-context';
import {
  AFFINITY_FLOOR,
  Compatibility,
  ConfidenceLevel,
  DIVERGENCE_MAX,
  INTERSECTION_MIN,
  PROXY_WEIGHT,
  ScoredEntity,
  computeCompatibility,
  dimensionOf,
} from '@/lib/scoring';
import { Trace, type TraceStep } from '@/lib/trace';
import { YouTubeChannel, findChannel } from '@/lib/youtube-channel';

// "Find creators": the brand goes in, ranked creators come out. Server-only.
//
// 1. Candidates: Qloo YouTubers (a person tag) ranked by the brand audience's affinity.
// 2. Each candidate's audience taste, straight from Qloo: the creator's person entity as
//    signal, top 5 per cross-domain type. No YouTube or LLM call is needed for a score.
// 3. One batched scoring call per type: the brand's affinity for every profile entity.
// 4. The same formula as a match (lib/scoring): rescaled affinity, dimensions, Fit Score.
//    Profile entities are inferred audience taste, not something the creator said, so they
//    weigh PROXY_WEIGHT and confidence is at most Medium. The brand → creator affinity
//    ("audience overlap") is shown but not scored, so the same evidence isn't counted twice.

export const CANDIDATES = 10;
const PROFILE_PER_TYPE = 5;
const MIN_PROFILE_ENTITIES = 10; // fewer scored profile entities → no score for that creator
const MEDIUM_PROFILE_ENTITIES = 20;
const MEDIUM_PROFILE_DIMENSIONS = 4;

export interface CreatorCandidate {
  rank: number;
  qlooId: string;
  name: string;
  description: string | null;
  audienceOverlap: number | null; // Qloo affinity of the brand's audience for the creator
  status: 'scored' | 'insufficient-data';
  noDataReason?: NoDataReason;
  compatibility: Compatibility;
  profile: { entities: number; scored: number; failedTypes: string[] };
  channel: YouTubeChannel | null;
}

export interface Discovery {
  id: string;
  createdAt: string;
  status: 'completed' | 'insufficient-data';
  errorMessage?: string;
  noDataReason?: NoDataReason;
  brand: Match['brand'];
  creatorCategory: CreatorCategory;
  candidates: CreatorCandidate[];
  warnings: string[];
  trace: TraceStep[];
  liveRun?: boolean;
}

export interface DiscoverInput {
  brandName: unknown;
  category?: unknown;
  creatorCategory?: unknown;
  referenceBrands?: unknown;
  brandDescription?: unknown;
  image?: unknown;
  live?: unknown;
}

const NO_SCORE: Compatibility = { fitScore: null, confidence: null, verdict: 'insufficient-data', dimensions: [] };

function discoveryId(input: DiscoverInput, category: CreatorCategory): string {
  const key = JSON.stringify([
    String(input.brandName || '').trim().toLocaleLowerCase(),
    category,
    input.referenceBrands ?? null,
    input.brandDescription ?? null,
    (input.image as any)?.data ? createHash('sha256').update(String((input.image as any).data)).digest('hex') : null,
  ]);
  return `discover_${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

// Only audience-taste evidence: Medium at best, Low with thin or narrow evidence.
function profileConfidence(scored: number, dimensions: number): ConfidenceLevel {
  return scored >= MEDIUM_PROFILE_ENTITIES && dimensions >= MEDIUM_PROFILE_DIMENSIONS ? 'Medium' : 'Low';
}

export async function runDiscover(input: DiscoverInput): Promise<Discovery> {
  const brandName = String(input.brandName || '').trim();
  if (!brandName) throw new ApiError('Provide a brand name.', 400);
  const creatorCategory: CreatorCategory = isCreatorCategory(input.creatorCategory) ? input.creatorCategory : 'any';
  const trace = new Trace();
  const warnings: string[] = [];
  const referenceBrands = Array.isArray(input.referenceBrands) ? input.referenceBrands.map(String).filter((s) => s.trim()) : [];
  const description = String(input.brandDescription || '').trim();

  const base = {
    id: discoveryId(input, creatorCategory),
    createdAt: new Date().toISOString(),
    creatorCategory,
    warnings,
    trace: trace.steps,
    liveRun: bypassCache(),
  };

  // 1. Brand side: the brand, or reference brands / description / key visual (lib/brand).
  const brand = await lookupBrand(brandName, input.category, trace, {
    referenceBrands: input.referenceBrands,
    description: input.brandDescription,
    image: input.image,
    proxies: false,
  });
  if (!brand.found) {
    return {
      ...base,
      status: 'insufficient-data',
      errorMessage: brand.error,
      noDataReason: brand.reason,
      brand: {
        ...brand.brand,
        entity: null,
        entities: [],
        suggestions: brand.suggestions,
        referenceBrands,
        ...(description ? { description } : {}),
        missingReferences: brand.missingReferences,
      },
      candidates: [],
    };
  }
  warnings.push(...brand.warnings);
  const brandSide: Match['brand'] = {
    ...brand.brand,
    entities: brand.entities,
    basis: brand.basis,
    signal: brand.signal,
    tags: brand.tags,
    imageTags: brand.imageTags,
    ...(brand.basis === 'reference' ? { referenceBrands } : {}),
    ...(brand.basis !== 'brand' && description ? { description } : {}),
  };
  const brandIds = new Set(brand.signal.map((e) => e.id));

  // 2. Candidates: Qloo people with the creator-type tag, ranked by the brand audience.
  const category = CREATOR_CATEGORIES[creatorCategory];
  let candidates: QlooEntity[];
  try {
    candidates = await getInsights(brand.signal, 'urn:entity:person', CANDIDATES, { trace, stage: 'candidates' }, brand.tags, {
      'filter.tags': category.tag,
    });
  } catch (e: any) {
    throw new ApiError(`Qloo candidate search failed: ${e.message}`, 502, { warnings });
  }
  candidates = candidates.filter((c) => !brandIds.has(c.id));
  trace.add({
    stage: 'candidates',
    tool: 'Rule',
    input: `Candidates: Qloo people tagged ${category.label} (${category.tag}), ranked by the brand audience’s affinity`,
    output: candidates.length ? `${candidates.length}: ${candidates.map((c) => c.name).join(', ')}` : 'None',
    decision: candidates.length
      ? 'Score each one from its audience taste in Qloo'
      : 'Stop: no candidates for this brand and creator type',
  });
  if (!candidates.length) {
    return {
      ...base,
      status: 'insufficient-data',
      errorMessage: `Qloo returned no ${category.label} creators for this brand.`,
      noDataReason: 'no-candidates',
      brand: brandSide,
      candidates: [],
    };
  }

  // Channels for the deep dive don't depend on the scores, so they're looked up meanwhile.
  const key = process.env.YOUTUBE_API_KEY;
  const channelsPromise = Promise.all(candidates.map((c) => findChannel(c.id, c.name, key, trace).catch(() => null)));

  // 3. Each candidate's audience taste: the creator as signal, top 5 per type. A failed
  //    query is recorded and asked once more after the rest, never treated as "this
  //    creator has no taste": a partial profile would move the creator in the ranking.
  const profileOf = (c: QlooEntity, type: string) => getInsights([c], type, PROFILE_PER_TYPE, { trace, stage: 'profile' });
  const lists = await Promise.all(
    candidates.map((c) => Promise.all(PROXY_TYPES.map((type) => profileOf(c, type).catch(() => null))))
  );
  const failed = lists.flatMap((l, i) => l.map((x, j) => (x === null ? [i, j] : null)).filter((x): x is number[] => x !== null));
  if (failed.length) {
    await new Promise((res) => setTimeout(res, 1000));
    for (const [i, j] of failed) lists[i][j] = await profileOf(candidates[i], PROXY_TYPES[j]).catch(() => null);
    const still = failed.filter(([i, j]) => lists[i][j] === null).length;
    trace.add({
      stage: 'profile',
      tool: 'Rule',
      input: `${failed.length} profile quer${failed.length === 1 ? 'y' : 'ies'} failed on the first pass`,
      output: still ? `${failed.length - still} recovered on a second pass, ${still} still failed` : 'All recovered on a second pass',
      decision: still ? 'The missing parts are reported for each creator, not treated as empty' : 'Profiles complete',
    });
  }
  const profiles = candidates.map((c, i) => {
    const failedTypes = PROXY_TYPES.filter((_, j) => lists[i][j] === null).map((t) => t.replace('urn:entity:', ''));
    const seen = new Set<string>();
    const entities = lists[i].flatMap((x) => x ?? []).filter((e) => !brandIds.has(e.id) && !seen.has(e.id) && seen.add(e.id));
    return { candidate: c, entities, failedTypes };
  });
  for (const p of profiles) {
    if (p.failedTypes.length) warnings.push(`${p.candidate.name}: Qloo failed to return ${p.failedTypes.join(', ')}; that part of the profile is missing.`);
  }

  // 4. The brand's affinity for every profile entity, one batched call per type.
  const all = [...new Map(profiles.flatMap((p) => p.entities).map((e) => [e.id, e])).values()];
  let affinities: Map<string, number>;
  try {
    affinities = await scoreEntities(brand.signal, all, { trace, stage: 'score' }, brand.tags);
  } catch (e: any) {
    throw new ApiError(`Qloo scoring request failed: ${e.message}`, 502, { warnings });
  }

  // 5. Same formula as a match, per creator.
  const scoredCandidates = profiles.map(({ candidate, entities, failedTypes }): Omit<CreatorCandidate, 'rank' | 'channel'> => {
    const items: ScoredEntity[] = [];
    for (const e of entities) {
      const brandAffinity = affinities.get(e.id);
      if (brandAffinity === undefined) continue;
      items.push({ ...e, side: 'proxy', weight: PROXY_WEIGHT, brandAffinity, dimension: dimensionOf(e) });
    }
    const common = {
      qlooId: candidate.id,
      name: candidate.name,
      description: candidate.description ?? null,
      audienceOverlap: candidate.affinity,
      profile: { entities: entities.length, scored: items.length, failedTypes },
    };
    if (items.length < MIN_PROFILE_ENTITIES) {
      return { ...common, status: 'insufficient-data', noDataReason: 'too-few-profile-entities', compatibility: NO_SCORE };
    }
    const c = computeCompatibility(items);
    const dims = c.dimensions.filter((d) => d.score !== null).length;
    const own: Compatibility = { ...c, confidence: profileConfidence(items.length, dims), confidenceBasis: { entities: items.length, dimensions: dims } };
    return { ...common, status: 'scored', compatibility: brandConfidence(own, brand) };
  });

  const ranked = scoredCandidates.sort(
    (a, b) =>
      Number(b.status === 'scored') - Number(a.status === 'scored') ||
      (b.compatibility.fitScore ?? -1) - (a.compatibility.fitScore ?? -1) ||
      (b.audienceOverlap ?? 0) - (a.audienceOverlap ?? 0)
  );
  const scoredCount = ranked.filter((c) => c.status === 'scored').length;
  trace.add({
    stage: 'score',
    tool: 'Rule',
    input: `Per creator: up to ${PROXY_TYPES.length * PROFILE_PER_TYPE} audience-taste entities at weight ${PROXY_WEIGHT}, sorted into dimensions; affinity rescaled from [${AFFINITY_FLOOR}, 1] to [0, 100]; shared taste ≥ ${INTERSECTION_MIN}, clash < ${DIVERGENCE_MAX}`,
    output: ranked.map((c) => `${c.name} ${c.compatibility.fitScore ?? 'no score'}`).join(' · '),
    decision: `Ranked by Fit Score, then audience overlap. Confidence: Medium with ${MEDIUM_PROFILE_ENTITIES}+ scored entities across ${MEDIUM_PROFILE_DIMENSIONS}+ dimensions, otherwise Low; fewer than ${MIN_PROFILE_ENTITIES} gets no score (${ranked.length - scoredCount} here)`,
  });
  // The brand-side approximation, once for the whole list (each score already carries it).
  const why = approximation(brand);
  if (why) {
    trace.add({
      stage: 'score',
      tool: 'Rule',
      input: `The brand side is approximated: ${why}`,
      output: 'Every creator’s confidence is one level lower (Medium → Low; Low stays Low)',
      decision: 'These approximate the brand’s audience, they aren’t it',
    });
  }

  // 6. YouTube channels for the deep dive; a creator without one keeps the Qloo score.
  const channels = await channelsPromise;
  const channelOf = new Map(candidates.map((c, i) => [c.id, channels[i]]));

  return {
    ...base,
    status: scoredCount ? 'completed' : 'insufficient-data',
    ...(scoredCount ? {} : { errorMessage: 'Qloo scored too little of every candidate’s audience taste to rank them.', noDataReason: 'too-few-profile-entities' as const }),
    brand: brandSide,
    candidates: ranked.map((c, i) => ({ ...c, rank: i + 1, channel: channelOf.get(c.qlooId) ?? null })),
  };
}
