import { createHash } from 'node:crypto';
import { lookupBrand } from '@/lib/brand';
import { CreatorTaste, getCreatorTaste } from '@/lib/creator';
import { ApiError } from '@/lib/errors';
import { PROXY_TYPES, QlooEntity, getInsights, scoreEntities } from '@/lib/qloo';
import { Report, buildReport } from '@/lib/report';
import {
  Compatibility,
  DIRECT_WEIGHT,
  MIN_DIRECT_ENTITIES,
  PROXY_WEIGHT,
  ScoredEntity,
  computeCompatibility,
  dimensionOf,
} from '@/lib/scoring';
import type { OnStage } from '@/lib/stages';
import { parseVideoId } from '@/lib/youtube-url';

// PRODUCT_SPEC v3.1 §6: collect (YouTube + Qloo) → score (lib/scoring) → report.
// Server-only. A batch comparison can call runMatch once per creator.

const CREATOR_PROXIES_PER_TYPE = 5;

export interface Match {
  id: string;
  createdAt: string;
  status: 'completed' | 'insufficient-data';
  errorMessage?: string;
  brand: { name: string; category: string | null; entity: QlooEntity | null; entities: QlooEntity[] };
  creator: {
    channelName: string;
    youtubeHandle: string;
    videoUrls: string[];
    videos: CreatorTaste['videos'];
    keywords: string[];
    keywordSource: CreatorTaste['keywordSource'];
    entities: QlooEntity[]; // Qloo entities named in the videos (before cross-domain expansion)
    unmatched: string[];
  };
  compatibility: Compatibility;
  mentionsBrand: boolean; // the creator's videos name the brand itself (not scored: circular)
  sharedEntities: ScoredEntity[];
  report: Report | null;
  warnings: string[];
  cachedAt?: string; // set when a stored demo snapshot is served instead of a live run
}

// Same videos + same brand → same id, so a re-run is recognisably the same match.
function matchId(urls: string[], brand: string): string {
  const ids = urls.map((u) => parseVideoId(u) || u).sort();
  const key = JSON.stringify([ids, brand.trim().toLocaleLowerCase()]);
  return `match_${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

const NO_SCORE: Compatibility = { fitScore: null, confidence: null, verdict: 'insufficient-data', dimensions: [] };

export interface MatchInput {
  videoUrls: unknown;
  brandName: unknown;
  category?: unknown;
}

export async function runMatch(input: MatchInput, onStage?: OnStage): Promise<Match> {
  const brandName = String(input.brandName || '').trim();
  if (!brandName) throw new ApiError('Provide a brand name.', 400);

  // 1. Collect both sides in parallel (lib/qloo throttles the shared rate limit).
  const [creator, brand] = await Promise.all([
    getCreatorTaste(input.videoUrls, onStage),
    lookupBrand(brandName, input.category).then((b) => {
      onStage?.('brand');
      return b;
    }),
  ]);

  const urls = (input.videoUrls as unknown[]).map(String);
  const channel = creator.channels[0];
  const base = {
    id: matchId(urls, brandName),
    createdAt: new Date().toISOString(),
    creator: {
      channelName: channel?.title || creator.videos[0]?.channelTitle || '',
      youtubeHandle: channel?.handle || '',
      videoUrls: urls,
      videos: creator.videos,
      keywords: creator.keywords,
      keywordSource: creator.keywordSource,
      entities: creator.entities,
      unmatched: creator.unmatched,
    },
    mentionsBrand: false,
    sharedEntities: [],
  };
  const warnings = [...creator.warnings];
  const insufficient = (errorMessage: string, b: Match['brand']): Match => ({
    ...base,
    status: 'insufficient-data',
    errorMessage,
    brand: b,
    compatibility: NO_SCORE,
    report: null,
    warnings,
  });

  if (!brand.found) {
    return insufficient(brand.error, { ...brand.brand, entity: null, entities: [] });
  }
  warnings.push(...brand.warnings);
  const brandSide = { ...brand.brand, entities: brand.entities };
  const brandEntity = brand.brand.entity;

  const direct = creator.entities;
  if (direct.length < MIN_DIRECT_ENTITIES) {
    return insufficient(
      `Qloo matched only ${direct.length} taste entities from the videos, below the scoring minimum of ${MIN_DIRECT_ENTITIES}.`,
      brandSide
    );
  }

  // 2. Expand the creator's taste across domains. The brand itself is left out of the
  //    signal, otherwise a creator who mentions Apple would inherit Apple's own proxies
  //    and score well against Apple by construction.
  const signal = direct.filter((e) => e.id !== brandEntity.id);
  const directIds = new Set(direct.map((e) => e.id));
  const proxies: QlooEntity[] = [];
  if (signal.length) {
    const batches = await Promise.all(
      PROXY_TYPES.map((type) =>
        getInsights(signal, type, CREATOR_PROXIES_PER_TYPE).catch((e) => {
          warnings.push(`Cross-domain expansion failed for ${type.replace('urn:entity:', '')}: ${e.message}`);
          return [] as QlooEntity[];
        })
      )
    );
    const seen = new Set([...directIds, brandEntity.id]);
    for (const e of batches.flat()) if (!seen.has(e.id) && seen.add(e.id)) proxies.push(e);
  }

  // 3. Ask Qloo how the brand's audience relates to each creator entity. The brand
  //    itself is not scored against itself; a direct mention is reported instead.
  const mentionsBrand = directIds.has(brandEntity.id);
  let affinities: Map<string, number>;
  try {
    affinities = await scoreEntities([brandEntity], [...signal, ...proxies]);
  } catch (e: any) {
    throw new ApiError(`Qloo scoring request failed: ${e.message}`, 502, { warnings });
  }

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

  // 4. Score by fixed formula, then write the report from the same evidence.
  const compatibility = computeCompatibility(items);
  onStage?.('score');
  if (compatibility.fitScore === null) {
    return insufficient('Qloo returned no affinity for any creator entity, so no score can be given.', brandSide);
  }

  const brandProxyIds = new Set(brand.entities.map((e) => e.id));
  const sharedEntities = items.filter((e) => brandProxyIds.has(e.id));
  const report = buildReport(
    brandEntity.name,
    base.creator.channelName || 'this creator',
    compatibility,
    items,
    sharedEntities,
    mentionsBrand
  );
  onStage?.('report');

  return { ...base, status: 'completed', mentionsBrand, brand: brandSide, compatibility, sharedEntities, report, warnings };
}
