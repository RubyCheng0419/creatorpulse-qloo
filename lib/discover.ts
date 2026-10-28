import { createHash } from 'node:crypto';
import { MIN_PROFILE_ENTITIES, PROFILE_PER_TYPE, audienceProfiles, findCreatorPerson, scoreProfile } from '@/lib/audience';
import { RANKING_CONTROLS, RankingValidation, controlResult, validateRanking, weakestDimension } from '@/lib/ranking-controls';
import { approximation, brandConfidence, lookupBrand } from '@/lib/brand';
import { CREATOR_CATEGORIES, CreatorCategory, isCreatorCategory } from '@/lib/creator-categories';
import { ApiError } from '@/lib/errors';
import type { Match } from '@/lib/match';
import type { NoDataReason } from '@/lib/no-data';
import { PROXY_TYPES, QlooEntity, getInsights, scoreEntities } from '@/lib/qloo';
import { bypassCache } from '@/lib/request-context';
import { AFFINITY_FLOOR, Compatibility, DIVERGENCE_MAX, INTERSECTION_MIN, PROXY_WEIGHT } from '@/lib/scoring';
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

export interface CreatorCandidate {
  rank: number;
  qlooId: string;
  name: string;
  description: string | null;
  audienceOverlap: number | null; // Qloo affinity of the brand's audience for the creator
  status: 'scored' | 'insufficient-data';
  noDataReason?: NoDataReason;
  compatibility: Compatibility;
  // failedTypes: Qloo failed to answer (transient); unsupportedTypes: Qloo answered that this
  // creator can't be a signal for the type (400), which a retry won't change.
  profile: { entities: number; scored: number; failedTypes: string[]; unsupportedTypes: string[] };
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
  validation?: RankingValidation; // absent on rankings saved before the checks existed
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

  // Win/lose controls (lib/ranking-controls), for the demo brands' default ranking only: resolved
  // like any creator (exact name, creator tag) and scored in the same batches, but not ranked.
  const controlSet = creatorCategory === 'any' && brand.basis === 'brand' ? RANKING_CONTROLS[(brand.brand.entity?.name || '').toLowerCase()] : undefined;
  const controlPeople = controlSet
    ? await Promise.all(
        (['fit', 'misfit'] as const).map(async (role) => {
          const name = controlSet[role];
          const inList = candidates.find((c) => c.name === name);
          return { role, name, person: inList ?? (await findCreatorPerson(name, '', trace)) };
        })
      )
    : [];
  const extra = controlPeople.flatMap((c) => (c.person && !candidates.some((x) => x.id === c.person!.id) ? [c.person] : []));

  // 3. Each candidate's audience taste (lib/audience), with failed queries asked again; the
  //    controls' alongside, in parallel and without that second pass (see audienceProfiles).
  const [candidateProfiles, extraProfiles] = await Promise.all([
    audienceProfiles(candidates, brandIds, trace),
    extra.length ? audienceProfiles(extra, brandIds, trace, true) : Promise.resolve([]),
  ]);
  const allProfiles = [...candidateProfiles, ...extraProfiles];
  const profiles = candidateProfiles.map((p) => ({ ...p, candidate: p.person }));
  const controlProfiles = new Map(allProfiles.map((p) => [p.person.id, p]));
  for (const p of profiles) {
    if (p.failedTypes.length) warnings.push(`${p.candidate.name}: Qloo failed to return ${p.failedTypes.join(', ')}; that part of the profile is missing.`);
  }

  // 4. The brand's affinity for every profile entity, one batched call per type.
  const all = [...new Map(allProfiles.flatMap((p) => p.entities).map((e) => [e.id, e])).values()];
  let affinities: Map<string, number>;
  try {
    affinities = await scoreEntities(brand.signal, all, { trace, stage: 'score' }, brand.tags);
  } catch (e: any) {
    throw new ApiError(`Qloo scoring request failed: ${e.message}`, 502, { warnings });
  }

  const failedScoring = trace.steps.filter((x) => x.stage === 'score' && !x.ok).length;
  if (failedScoring) warnings.push(`${failedScoring} scoring quer${failedScoring === 1 ? 'y' : 'ies'} failed; those entities are left out of every creator’s score.`);

  // 5. Same formula as a match, per creator.
  const scoredCandidates = profiles.map(({ candidate, entities, failedTypes, unsupportedTypes }): Omit<CreatorCandidate, 'rank' | 'channel'> => {
    const { items, compatibility } = scoreProfile(entities, affinities);
    const common = {
      qlooId: candidate.id,
      name: candidate.name,
      description: candidate.description ?? null,
      audienceOverlap: candidate.affinity,
      profile: { entities: entities.length, scored: items.length, failedTypes, unsupportedTypes },
    };
    if (!compatibility) return { ...common, status: 'insufficient-data', noDataReason: 'too-few-profile-entities', compatibility: NO_SCORE };
    return { ...common, status: 'scored', compatibility: brandConfidence(compatibility, brand) };
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
    decision: `Ranked by Fit Score, then audience overlap. A dimension counts with 3+ entities; confidence: Medium with 20+ scored entities across 4+ counted dimensions, otherwise Low; fewer than ${MIN_PROFILE_ENTITIES} scored, or fewer than 2 counted dimensions, gets no score (${ranked.length - scoredCount} here)`,
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

  // 6. Validity checks before the ranking is presented as a result: the controls, then whether
  //    one dimension drags every creator down.
  const controls = controlSet
    ? controlPeople.map(({ role, name, person }) => {
        const profile = person ? controlProfiles.get(person.id) : undefined;
        const scored = profile ? scoreProfile(profile.entities, affinities).compatibility : null;
        const rank = person ? ranked.findIndex((c) => c.qlooId === person.id) + 1 || null : null;
        // A control Qloo itself ranked came from the ranking, not from a name search.
        const namesakes = (person as { namesakes?: number } | null)?.namesakes ?? 0;
        return controlResult(role, name, person?.id ?? null, scored ? brandConfidence(scored, brand) : null, rank, profile?.failedTypes ?? [], namesakes);
      })
    : null;
  const validation: RankingValidation = { ...validateRanking(ranked, controls), weakest: weakestDimension(ranked) };
  trace.add({
    stage: 'score',
    tool: 'Rule',
    input: controls
      ? `Win/lose controls: ${controls.map((c) => `${c.name} (obvious ${c.role}) ${c.fitScore ?? 'no score'}${c.strongest ? `, strongest ${c.strongest}, weakest ${c.weakest}` : ''}`).join(' · ')}`
      : 'Win/lose controls for this brand and creator type',
    output: validation.reasons.join(' '),
    decision:
      validation.status === 'validated'
        ? 'Ranking validated'
        : validation.status === 'unverified'
          ? 'Ranking unverified: shown as “do not use for a decision”, without fit verdicts'
          : 'Not validated: no usable controls; the ranking is labelled as such',
  });
  if (validation.weakest)
    trace.add({
      stage: 'score',
      tool: 'Rule',
      input: `Weakest dimension across the ranking: ${validation.weakest.label} for ${validation.weakest.count} of ${validation.weakest.of} creators`,
      output: `Top 3 ${validation.weakest.top3.join(', ')}; without ${validation.weakest.label}: ${validation.weakest.top3Without.join(', ')}`,
      decision: validation.weakest.top3.join() === validation.weakest.top3Without.join() ? 'Same top 3: that dimension doesn’t decide the ranking' : 'The top 3 change without it: reported beside the ranking',
    });

  // 7. YouTube channels for the deep dive; a creator without one keeps the Qloo score.
  const channels = await channelsPromise;
  const channelOf = new Map(candidates.map((c, i) => [c.id, channels[i]]));

  return {
    ...base,
    status: scoredCount ? 'completed' : 'insufficient-data',
    ...(scoredCount ? {} : { errorMessage: 'Qloo scored too little of every candidate’s audience taste to rank them.', noDataReason: 'too-few-profile-entities' as const }),
    brand: brandSide,
    candidates: ranked.map((c, i) => ({ ...c, rank: i + 1, channel: channelOf.get(c.qlooId) ?? null })),
    validation,
  };
}
