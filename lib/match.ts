import { createHash } from 'node:crypto';
import { audienceProfiles, findCreatorPerson, scoreProfile } from '@/lib/audience';
import { BrandBasis, MissingReference, brandConfidence, lookupBrand } from '@/lib/brand';
import { CreatorTaste, getCreatorTaste } from '@/lib/creator';
import { ApiError, errorMessage } from '@/lib/errors';
import {
  EXPANSION_POPULARITY_MIN,
  PROXY_TYPES,
  QlooEntity,
  QlooTag,
  TagComparison,
  compareTags,
  expansionParams,
  getInsights,
  scoreEntities,
  verifyEntities,
} from '@/lib/qloo';
import type { NoDataReason } from '@/lib/no-data';
import { InsufficientCause, causeCounts, insufficientCause } from '@/lib/no-data-cause';
import { PriorCoverage, brandTermsOf, priorCoverage, productTermsOf } from '@/lib/prior-coverage';
import { Report, SummaryContext, VERDICT_LABELS, buildReport } from '@/lib/report';
import {
  AFFINITY_FLOOR,
  Compatibility,
  DIRECT_WEIGHT,
  DIVERGENCE_MAX,
  INTERSECTION_MIN,
  MIN_COUNTED_DIMENSIONS,
  MIN_DIMENSION_ENTITIES,
  MIN_DIRECT_ENTITIES,
  PROXY_WEIGHT,
  ScoredEntity,
  computeCompatibility,
  dimensionOf,
  isCounted,
} from '@/lib/scoring';
import { bypassCache } from '@/lib/request-context';
import type { OnStage } from '@/lib/stages';
import { Trace, type TraceStep } from '@/lib/trace';
import { parseVideoId } from '@/lib/youtube-url';

// PRODUCT_SPEC v3.1 §6: collect (YouTube + Gemini or Groq + Qloo) → score (lib/scoring) → report.
// Every tool call and decision is recorded in the Agent Trace. Server-only.
// A batch comparison can call runMatch once per creator.

const CREATOR_PROXIES_PER_TYPE = 5;

export interface Match {
  id: string;
  createdAt: string;
  status: 'completed' | 'insufficient-data';
  errorMessage?: string;
  noDataReason?: NoDataReason; // why there is no score, as a countable category
  // For too few entities from the videos: the one cause, with its counts (lib/no-data-cause).
  cause?: InsufficientCause;
  brand: {
    name: string;
    category: string | null;
    entity: QlooEntity | null; // null when the brand isn't in Qloo
    entities: QlooEntity[];
    suggestions?: string[]; // Qloo brands whose name starts with the input, when there was no exact match
    // How the brand side was built; 'reference' means the brand isn't in Qloo and the
    // user's reference brands (signal) stand in for its audience.
    basis?: BrandBasis;
    signal?: QlooEntity[];
    tags?: QlooTag[];
    imageTags?: QlooTag[]; // the tags inferred from a key visual
    referenceBrands?: string[]; // as the user typed them
    description?: string; // the brand description or web page URL the user gave
    missingReferences?: MissingReference[];
  };
  creator: {
    channelName: string;
    youtubeHandle: string;
    videoUrls: string[];
    videos: CreatorTaste['videos'];
    keywords: string[];
    keywordSource: CreatorTaste['keywordSource'];
    extractionModel?: string;
    extractionFallback?: string; // why Gemini didn't answer, when Groq did
    geminiCached?: boolean; // the name extraction (Gemini or Groq) came from the 24-hour cache
    geminiAt?: string;
    entities: QlooEntity[]; // Qloo entities named in the videos (before cross-domain expansion)
    unmatched: string[];
    // The creator's own Qloo entity, when one matches the channel; namesakes: exact-name Qloo
    // people found, of whom the creator tag picked this one (2+ = identity rests on the tag).
    qlooPerson?: { id: string; name: string; namesakes?: number };
    audienceOverlap?: number | null; // the brand audience's affinity for that person (shown, not scored)
  };
  // 'videos': scored from what the videos name (the usual case). 'audience': the videos named
  // too little, so the score comes from the creator's audience taste in Qloo (lib/audience).
  scoreBasis?: 'videos' | 'audience';
  compatibility: Compatibility;
  mentionsBrand: boolean; // the creator's videos name the brand itself (not scored: circular)
  // Whether the videos read mention the brand or its products (lib/prior-coverage): from
  // YouTube text, CreatorPulse's own tier, never part of the Fit Score. Absent on older results.
  priorCoverage?: PriorCoverage;
  sharedEntities: ScoredEntity[];
  report: Report | null;
  warnings: string[];
  trace: TraceStep[];
  liveRun?: boolean; // "Run live": every Qloo, YouTube and Gemini call bypassed the cache
  cachedAt?: string; // set when a stored demo snapshot is served instead of a live run
  // 'demo': a demo click, served from the snapshot by design; 'fallback': a live run failed.
  cachedReason?: 'demo' | 'fallback';
  // GET /v2/analysis/compare of the brand side and the creator's confirmed entities: an
  // independent cross-check shown next to the Fit Score, never part of it.
  crossCheck?: TagComparison | { skipped: string };
  // How cross-domain entities were gathered, for the report.
  expansion?: { popularityMin: number; excludesBrand: boolean };
}

// Same videos + same brand side → same id, so a re-run is recognisably the same match.
function matchId(urls: string[], brand: string, references: string[]): string {
  const ids = urls.map((u) => parseVideoId(u) || u).sort();
  const brandKey = [brand, ...references].map((s) => s.trim().toLocaleLowerCase());
  const key = JSON.stringify([ids, references.length ? brandKey : brandKey[0]]);
  return `match_${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

// Why the videos fell short. A video about the brand's own products names only the brand,
// which is never scored, so "only 1 matched" alone would read as Qloo missing it.
function tooFewMessage(direct: QlooEntity[], brandSignal: QlooEntity[]): string {
  const brandNamed = direct.filter((e) => brandSignal.some((b) => b.id === e.id));
  const others = direct.length - brandNamed.length;
  const count = (n: number) => `${n} taste entit${n === 1 ? 'y' : 'ies'}`;
  if (!brandNamed.length) return `Qloo matched only ${count(direct.length)} from the videos, below the scoring minimum of ${MIN_DIRECT_ENTITIES}.`;
  return `The videos name ${brandNamed.map((e) => e.name).join(', ')}, the brand being scored, which is reported but never scored against itself. Besides it, Qloo matched ${count(others)} from the videos, below the scoring minimum of ${MIN_DIRECT_ENTITIES}.`;
}

const NO_SCORE: Compatibility ={ fitScore: null, confidence: null, verdict: 'insufficient-data', dimensions: [] };

export interface MatchInput {
  videoUrls: unknown;
  brandName: unknown;
  category?: unknown;
  live?: unknown; // true: bypass the Qloo and YouTube caches for this run
  referenceBrands?: unknown; // only used when the brand isn't in Qloo
  brandDescription?: unknown; // likewise: a short description of the brand, or its https:// page
}

export async function runMatch(input: MatchInput, onStage?: OnStage): Promise<Match> {
  const brandName = String(input.brandName || '').trim();
  if (!brandName) throw new ApiError('Provide a brand name.', 400);
  const trace = new Trace();

  // 1. Collect both sides in parallel (lib/qloo throttles the shared rate limit).
  const [creator, brand] = await Promise.all([
    getCreatorTaste(input.videoUrls, onStage, trace),
    lookupBrand(brandName, input.category, trace, {
      referenceBrands: input.referenceBrands,
      description: input.brandDescription,
    }).then((b) => {
      onStage?.('brand');
      return b;
    }),
  ]);

  const urls = (input.videoUrls as unknown[]).map(String);
  const referenceBrands = Array.isArray(input.referenceBrands) ? input.referenceBrands.map(String).filter((s) => s.trim()) : [];
  const description = String(input.brandDescription || '').trim();
  const channel = creator.channels[0];
  // Prior coverage: from the videos already read, never part of the Fit Score.
  const brandTerms = brandTermsOf(brandName, brand.found ? brand.brand.entity?.name : null);
  const coverage = priorCoverage(creator.videos, creator.descriptions, brandTerms, productTermsOf(creator.products, brandTerms));
  trace.add({
    stage: 'creator',
    tool: 'Rule',
    input: `Prior coverage: ${creator.videos.length} video${creator.videos.length === 1 ? '' : 's'}’ titles, descriptions and tags searched for ${brandTerms.map((t) => `“${t}”`).join(', ')}${coverage.productTerms.length ? ` and its product names (${coverage.productTerms.join(', ')})` : ''}`,
    output: `${coverage.mentioning.length} of ${coverage.videosRead} mention the brand · tier ${coverage.tier}`,
    decision: 'Shown next to the Fit Score; never scored (the brand itself is not scored, and a mention is not an endorsement)',
  });
  const base = {
    id: matchId(urls, brandName, description ? [...referenceBrands, description] : referenceBrands),
    createdAt: new Date().toISOString(),
    creator: {
      channelName: channel?.title || creator.videos[0]?.channelTitle || '',
      youtubeHandle: channel?.handle || '',
      videoUrls: urls,
      videos: creator.videos,
      keywords: creator.keywords,
      keywordSource: creator.keywordSource,
      extractionModel: creator.extractionModel,
      extractionFallback: creator.extractionFallback,
      geminiCached: creator.geminiCached,
      geminiAt: creator.geminiAt,
      entities: creator.entities,
      unmatched: creator.unmatched,
    } as Match['creator'],
    mentionsBrand: false,
    priorCoverage: coverage,
    sharedEntities: [],
    trace: trace.steps,
    liveRun: bypassCache(),
  };
  const warnings = [...creator.warnings];
  const insufficient = (noDataReason: NoDataReason, errorMessage: string, b: Match['brand']): Match => ({
    ...base,
    status: 'insufficient-data',
    errorMessage,
    noDataReason,
    brand: b,
    compatibility: NO_SCORE,
    report: null,
    warnings,
  });

  if (!brand.found) {
    return insufficient(brand.reason, brand.error, {
      ...brand.brand,
      entity: null,
      entities: [],
      suggestions: brand.suggestions,
      referenceBrands,
      ...(description ? { description } : {}),
      missingReferences: brand.missingReferences,
    });
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
  // The brand-side signal: the brand itself, or the reference brands standing in for it.
  const brandSignal = brand.signal;
  const brandTags = brand.tags;
  const brandIds = new Set(brandSignal.map((e) => e.id));
  const brandLabel = brand.brand.entity?.name || brandName;
  // What the Summary says the score rests on (lib/report decisionSummary).
  const summaryContextFor = (scoreBasis: 'videos' | 'audience'): SummaryContext => ({
    brand: brandLabel,
    basis: brand.basis,
    brandSignal: brandSignal.map((e) => e.name),
    styleTags: brandTags.filter((t) => !brand.imageTags.some((i) => i.id === t.id)).map((t) => t.name),
    imageTags: brand.imageTags.map((t) => t.name),
    scoreBasis,
    person: base.creator.qlooPerson?.name,
    fromChannel: urls.length === 1 && !parseVideoId(urls[0]),
    coverage,
  });

  // The creator's own Qloo entity: for the audience overlap, and as the fallback evidence
  // when the videos name too little.
  const found = channel ? await findCreatorPerson(channel.title, channel.handle, trace) : null;

  // Every /search-confirmed creator entity is re-checked against Qloo's own record (GET /entities),
  // in one call; one that no longer matches by name or alias is dropped before counting.
  const { kept } = await verifyEntities([...creator.entities, ...(found ? [found] : [])], { trace, stage: 'creator' });
  const keptIds = new Map(kept.map((e) => [e.id, e]));
  const person = found ? (keptIds.get(found.id) ?? null) : null;
  if (person) base.creator = { ...base.creator, qlooPerson: { id: person.id, name: person.name, namesakes: found!.namesakes } };

  const direct = creator.entities.filter((e) => keptIds.has(e.id)).map((e) => keptIds.get(e.id)!);
  base.creator = { ...base.creator, entities: direct };
  // The brand itself is never scored (step 2), so it doesn't count towards the minimum.
  const enough = !creator.extractionError && direct.filter((e) => !brandIds.has(e.id)).length >= MIN_DIRECT_ENTITIES;
  trace.add({
    stage: 'creator',
    tool: 'Rule',
    input: `Evidence threshold: at least ${MIN_DIRECT_ENTITIES} Qloo-confirmed entities from the videos, besides the brand itself`,
    output: creator.extractionError
      ? `No names extracted: ${creator.extractionError}`
      : `${direct.length} confirmed: ${direct.map((e) => (brandIds.has(e.id) ? `${e.name} (the brand itself)` : e.name)).join(', ') || 'none'}`,
    decision: enough
      ? 'Continue'
      : person
        ? `Not enough from the videos: score from ${person.name}’s audience taste in Qloo instead`
        : 'Stop: not enough evidence, no score is given',
  });
  if (!enough) {
    const why: [NoDataReason, string] = creator.extractionError
      ? ['llm-unavailable', `Couldn’t extract the names mentioned in the videos (${creator.extractionError}). No score is given rather than one built on guessed keywords. Please try again later.`]
      : ['too-few-creator-entities', tooFewMessage(direct, brandSignal)];
    // One cause, from what this run logged; the same object goes to the trace and the page.
    const classify = () => {
      const names = creator.resolution.map((n) =>
        n.entity && !keptIds.has(n.entity.id) ? { ...n, status: 'unverified' as const, note: 'GET /entities no longer confirmed it' } : n
      );
      const cause = insufficientCause({ ...creator, names, brandIds: [...brandIds], trace: trace.steps });
      trace.add({
        stage: 'creator',
        tool: 'Rule',
        input: 'Insufficient-data cause, from this run’s logged calls',
        output: `${cause.title}: ${causeCounts(cause)} · LLM: ${cause.llm}${cause.failedCalls.length ? ` · failed: ${cause.failedCalls.join('; ')}` : ''}`,
        decision: cause.detail,
      });
      return cause;
    };
    if (!person) return { ...insufficient(why[0], why[1], brandSide), cause: classify() };

    // Fallback: the creator's audience taste, scored like a Find creators candidate.
    const [profile] = await audienceProfiles([person], brandIds, trace);
    let aff: Map<string, number>;
    try {
      aff = await scoreEntities(brandSignal, [...profile.entities, person], { trace, stage: 'score' }, brandTags);
    } catch (e) {
      throw new ApiError(`Qloo scoring request failed: ${errorMessage(e)}`, 502, { warnings });
    }
    base.creator = { ...base.creator, audienceOverlap: aff.get(person.id) ?? null };
    const { items: profileItems, compatibility: fromAudience } = scoreProfile(profile.entities, aff);
    trace.add({
      stage: 'score',
      tool: 'Rule',
      input: `${person.name}’s audience taste: ${profileItems.length} Qloo entities scored at weight ${PROXY_WEIGHT}, same formula; confidence at most Medium`,
      output: fromAudience ? `Fit Score ${fromAudience.fitScore}, confidence ${fromAudience.confidence}` : `Only ${profileItems.length} scored, below 10`,
      decision: fromAudience ? 'Scored from audience taste; labelled as such' : 'Stop: not enough audience-taste evidence either',
    });
    onStage?.('score');
    if (!fromAudience)
      return { ...insufficient(why[0], `${why[1]} ${person.name}’s audience taste in Qloo was too thin to score as well.`, brandSide), cause: classify() };
    const audienceCompat = brandConfidence(fromAudience, brand, trace);
    const proxyIds = new Set(brand.entities.map((e) => e.id));
    const shared = profileItems.filter((e) => proxyIds.has(e.id));
    const audienceReport = buildReport(brandLabel, base.creator.channelName || person.name, audienceCompat, profileItems, shared, summaryContextFor('audience'));
    onStage?.('report');
    return {
      ...base,
      status: 'completed',
      scoreBasis: 'audience',
      mentionsBrand: false,
      brand: brandSide,
      compatibility: audienceCompat,
      sharedEntities: shared,
      report: audienceReport,
      warnings: [...warnings, ...(profile.failedTypes.length ? [`Qloo failed to return ${profile.failedTypes.join(', ')} for ${person.name}.`] : [])],
    };
  }

  // 2. Expand the creator's taste across domains. The brand itself is left out of the
  //    signal, otherwise a creator who mentions Apple would inherit Apple's own proxies
  //    and score well against Apple by construction.
  //    The same holds for reference brands standing in for the brand.
  const signal = direct.filter((e) => !brandIds.has(e.id));
  const directIds = new Set(direct.map((e) => e.id));
  const mentioned = brandSignal.filter((e) => directIds.has(e.id));
  const mentionsBrand = mentioned.length > 0;
  if (mentionsBrand) {
    const names = mentioned.map((e) => e.name).join(', ');
    trace.add({
      stage: 'expand',
      tool: 'Rule',
      input: `The videos mention the brand-side signal itself (${names})`,
      output: `${signal.length} other entities form the expansion signal`,
      decision: `Leave ${names} out of the signal and out of scoring, so the brand side isn’t scored against itself; reported instead`,
    });
  }
  const proxies: QlooEntity[] = [];
  if (signal.length) {
    const batches = await Promise.all(
      PROXY_TYPES.map((type) =>
        getInsights(signal, type, CREATOR_PROXIES_PER_TYPE, { trace, stage: 'expand' }, [], expansionParams([...brandIds])).catch((e) => {
          warnings.push(`Cross-domain expansion failed for ${type.replace('urn:entity:', '')}: ${errorMessage(e)}`);
          return [] as QlooEntity[];
        })
      )
    );
    const seen = new Set([...directIds, ...brandIds]);
    for (const e of batches.flat()) if (!seen.has(e.id) && seen.add(e.id)) proxies.push(e);
  }

  // 3. Ask Qloo how the brand's audience relates to each creator entity.
  let affinities: Map<string, number>;
  try {
    affinities = await scoreEntities(brandSignal, [...signal, ...proxies, ...(person ? [person] : [])], { trace, stage: 'score' }, brandTags);
  } catch (e) {
    throw new ApiError(`Qloo scoring request failed: ${errorMessage(e)}`, 502, { warnings });
  }

  if (person) base.creator = { ...base.creator, audienceOverlap: affinities.get(person.id) ?? null };
  const items: ScoredEntity[] = [];
  for (const [side, list] of [['direct', signal], ['proxy', proxies]] as const) {
    for (const e of list) {
      const brandAffinity = affinities.get(e.id);
      if (brandAffinity === undefined) continue;
      items.push({
        ...e,
        side,
        weight: side === 'direct' ? DIRECT_WEIGHT : PROXY_WEIGHT,
        brandAffinity,
        dimension: dimensionOf(e),
      });
    }
  }
  const unscored = signal.length + proxies.length - items.length;
  if (unscored) warnings.push(`${unscored} creator entities got no affinity from Qloo with the brand as signal and were not scored.`);

  // The evidence threshold again, on what Qloo actually scored: confirmed entities that got no
  // affinity are not evidence, and cross-domain ones can't make up for them.
  const directScored = items.filter((i) => i.side === 'direct').length;
  trace.add({
    stage: 'score',
    tool: 'Rule',
    input: `Evidence threshold after scoring: at least ${MIN_DIRECT_ENTITIES} named entities with a Qloo affinity`,
    output: `${directScored} of ${signal.length} named entities scored`,
    decision: directScored >= MIN_DIRECT_ENTITIES ? 'Continue' : 'Stop: not enough scored evidence, no score is given',
  });
  if (directScored < MIN_DIRECT_ENTITIES) {
    return insufficient(
      'too-few-creator-entities',
      `Qloo gave an affinity for only ${directScored} of the entities named in the videos, below the scoring minimum of ${MIN_DIRECT_ENTITIES}.`,
      brandSide
    );
  }

  // 4. Score by fixed formula, then write the report from the same evidence.
  let compatibility = computeCompatibility(items);
  const scored = compatibility.dimensions.filter(isCounted);
  const empty = compatibility.dimensions.filter((d) => d.score === null);
  const thin = compatibility.dimensions.filter((d) => d.score !== null && !isCounted(d));
  trace.add({
    stage: 'score',
    tool: 'Rule',
    input: `${items.length} scored entities (${items.filter((i) => i.side === 'direct').length} named in the videos at weight ${DIRECT_WEIGHT}, ${items.filter((i) => i.side === 'proxy').length} cross-domain at weight ${PROXY_WEIGHT}) sorted into dimensions by Qloo type and genre tags`,
    output: compatibility.dimensions
      .map((d) => `${d.label} ${d.score ?? 'no data'} (n=${d.itemCount}${d.score !== null && !isCounted(d) ? ', thin' : ''}${d.byDefault ? ', classified by default' : ''})`)
      .join(' · '),
    decision:
      `Affinity rescaled from [${AFFINITY_FLOOR}, 1] to [0, 100]; strong shared taste ≥ ${INTERSECTION_MIN}, some shared taste ${DIVERGENCE_MAX}–${INTERSECTION_MIN}, conflicting taste < ${DIVERGENCE_MAX}` +
      (empty.length ? `; ${empty.map((d) => d.label).join(', ')} excluded (no data, not counted as zero)` : '') +
      (thin.length ? `; ${thin.map((d) => d.label).join(', ')} shown, not counted (fewer than ${MIN_DIMENSION_ENTITIES} entities)` : ''),
  });
  onStage?.('score');
  if (compatibility.fitScore === null) {
    return scored.length || thin.length
      ? insufficient(
          'too-few-dimensions',
          `Only ${scored.length} taste dimension${scored.length === 1 ? ' has' : 's have'} ${MIN_DIMENSION_ENTITIES} or more scored entities; a score needs at least ${MIN_COUNTED_DIMENSIONS}.`,
          brandSide
        )
      : insufficient('no-affinity', 'Qloo returned no affinity for any creator entity, so no score can be given.', brandSide);
  }
  const evidenceLevel = compatibility.confidence!;
  trace.add({
    stage: 'score',
    tool: 'Rule',
    input: `Equal-weight mean of ${scored.length} counted dimension${scored.length === 1 ? '' : 's'} (${MIN_DIMENSION_ENTITIES}+ entities each)`,
    output:
      `Fit Score ${compatibility.fitScore}, confidence ${evidenceLevel}` +
      (compatibility.confidenceBasis
        ? ` (based on ${compatibility.confidenceBasis.entities} named entities across ${compatibility.confidenceBasis.dimensions} counted dimensions; High = 10+ entities and all 5 dimensions, Medium = 5+ entities and 3+ dimensions, Low = less)`
        : ''),
    decision: `Verdict: ${VERDICT_LABELS[compatibility.verdict]} (80+ strong, 60–79 moderate, 40–59 weak, below 40 no fit)`,
  });
  // Reference brands, a description or a key visual only approximate the brand's audience.
  compatibility = brandConfidence(compatibility, brand, trace);

  const brandProxyIds = new Set(brand.entities.map((e) => e.id));
  const sharedEntities = items.filter((e) => brandProxyIds.has(e.id));
  const report = buildReport(
    brandLabel,
    base.creator.channelName || 'this creator',
    compatibility,
    items,
    sharedEntities,
    summaryContextFor('videos')
  );
  trace.add({
    stage: 'report',
    tool: 'Rule',
    input: 'Report template filled from the scored entities (no LLM)',
    output: `${report.recommendations.length} recommendations, ${report.risks.length} risks, ${sharedEntities.length} entities shared with the brand’s Qloo proxies`,
  });
  // 5. Independent cross-check: Qloo compares the tags of the brand side (A) and the
  //    creator's confirmed entities (B). Reported beside the Fit Score; it never changes it.
  let crossCheck: Match['crossCheck'];
  if (!brandSignal.length) {
    crossCheck = { skipped: 'The brand side is Qloo tags only, with no entities to compare.' };
  } else {
    try {
      crossCheck = await compareTags(brandSignal, signal, { trace, stage: 'report' });
    } catch (e) {
      crossCheck = { skipped: `Qloo’s comparison failed (${(e as Error).message}).` }; // already traced with its HTTP attempts
    }
  }
  if ('skipped' in crossCheck)
    trace.add({ stage: 'report', tool: 'Rule', input: 'Cross-check with GET /v2/analysis/compare', output: crossCheck.skipped, decision: 'Skip the cross-check; the Fit Score is unaffected' });
  onStage?.('report');

  return {
    ...base,
    status: 'completed',
    scoreBasis: 'videos',
    mentionsBrand,
    brand: brandSide,
    compatibility,
    sharedEntities,
    report,
    warnings,
    crossCheck,
    expansion: { popularityMin: EXPANSION_POPULARITY_MIN, excludesBrand: brandIds.size > 0 },
  };
}
