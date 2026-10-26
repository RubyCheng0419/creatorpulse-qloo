import { PROXY_TYPES, QlooEntity, getInsights, namesMatch, searchEntities } from '@/lib/qloo';
import { Compatibility, ConfidenceLevel, PROXY_WEIGHT, ScoredEntity, computeCompatibility, dimensionOf } from '@/lib/scoring';
import type { Trace } from '@/lib/trace';

// A creator's audience taste, straight from Qloo: the creator's person entity as signal,
// top 5 per cross-domain type. Shared by Find creators (every candidate) and Check a creator
// (when the videos name too little). Server-only.
//
// These entities are Qloo's inference of what the audience likes, one step removed, so they
// weigh PROXY_WEIGHT like a match's cross-domain expansion, and confidence is at most Medium.

export const PROFILE_PER_TYPE = 5;
export const MIN_PROFILE_ENTITIES = 10; // fewer scored profile entities → no score
const MEDIUM_PROFILE_ENTITIES = 20;
const MEDIUM_PROFILE_DIMENSIONS = 4;

export interface AudienceProfile {
  person: QlooEntity;
  entities: QlooEntity[];
  failedTypes: string[]; // Qloo failed to answer (transient)
  unsupportedTypes: string[]; // Qloo answered that this person can't be a signal for the type (400)
}

// Profiles for several people at once. A failed query is asked once more after the rest,
// never treated as "this creator has no taste": a partial profile would move the creator in
// a ranking. Some Qloo people are not valid signals for some types (400 "signal.interests.
// entities were invalid"); that is Qloo's data, not a failure, so it isn't retried.
export async function audienceProfiles(people: QlooEntity[], exclude: Set<string>, trace?: Trace): Promise<AudienceProfile[]> {
  const UNSUPPORTED = 'unsupported' as const;
  const profileOf = (c: QlooEntity, type: string) =>
    getInsights([c], type, PROFILE_PER_TYPE, trace && { trace, stage: 'profile' }).catch((e: any) => (e?.status === 400 ? UNSUPPORTED : null));
  const lists = await Promise.all(people.map((c) => Promise.all(PROXY_TYPES.map((type) => profileOf(c, type)))));
  const failed = lists.flatMap((l, i) => l.map((x, j) => (x === null ? [i, j] : null)).filter((x): x is number[] => x !== null));
  if (failed.length) {
    await new Promise((res) => setTimeout(res, 1000));
    for (const [i, j] of failed) lists[i][j] = await profileOf(people[i], PROXY_TYPES[j]);
    const still = failed.filter(([i, j]) => lists[i][j] === null).length;
    trace?.add({
      stage: 'profile',
      tool: 'Rule',
      input: `${failed.length} profile quer${failed.length === 1 ? 'y' : 'ies'} failed on the first pass`,
      output: still ? `${failed.length - still} recovered on a second pass, ${still} still failed` : 'All recovered on a second pass',
      decision: still ? 'The missing parts are reported for each creator, not treated as empty' : 'Profiles complete',
    });
  }
  const typesWhere = (i: number, test: (x: unknown) => boolean) =>
    PROXY_TYPES.filter((_, j) => test(lists[i][j])).map((t) => t.replace('urn:entity:', ''));
  return people.map((person, i) => {
    const seen = new Set<string>();
    const entities = lists[i]
      .flatMap((x) => (Array.isArray(x) ? x : []))
      .filter((e) => !exclude.has(e.id) && !seen.has(e.id) && seen.add(e.id));
    return { person, entities, failedTypes: typesWhere(i, (x) => x === null), unsupportedTypes: typesWhere(i, (x) => x === UNSUPPORTED) };
  });
}

// Only audience-taste evidence: Medium at best, Low with thin or narrow evidence.
function profileConfidence(scored: number, dimensions: number): ConfidenceLevel {
  return scored >= MEDIUM_PROFILE_ENTITIES && dimensions >= MEDIUM_PROFILE_DIMENSIONS ? 'Medium' : 'Low';
}

// The same formula as a match, on the profile entities the brand's audience was scored for.
// null when fewer than MIN_PROFILE_ENTITIES were scored.
export function scoreProfile(entities: QlooEntity[], affinities: Map<string, number>): { items: ScoredEntity[]; compatibility: Compatibility | null } {
  const items: ScoredEntity[] = [];
  for (const e of entities) {
    const brandAffinity = affinities.get(e.id);
    if (brandAffinity === undefined) continue;
    items.push({ ...e, side: 'proxy', weight: PROXY_WEIGHT, brandAffinity, dimension: dimensionOf(e) });
  }
  if (items.length < MIN_PROFILE_ENTITIES) return { items, compatibility: null };
  const c = computeCompatibility(items);
  const dims = c.dimensions.filter((d) => d.score !== null).length;
  return { items, compatibility: { ...c, confidence: profileConfidence(items.length, dims), confidenceBasis: { entities: items.length, dimensions: dims } } };
}

// Tags that mark a Qloo person as a creator. Coverage varies (MKBHD has genre:person:
// youtuber, Nikkie de Jager only occupation:person:youtuber, Nick DiGiovanni only
// internet_celebrity), so any of them counts. An actor namesake (Tom Holland) has none.
const CREATOR_TAG = /^urn:tag:(genre:person:(youtuber|influencer)|occupation:person:(youtuber|video_blogger|vlogger|internet_celebrity|influencer)|wikipedia_category:wikidata:.*youtubers?(_|$).*)/;
const isCreator = (r: any) => (r?.tags || []).some((t: any) => CREATOR_TAG.test(t?.tag_id || t?.id || ''));

// The Qloo person behind a channel: the channel's title, then its handle, must be the
// person's exact name or alias ("阿滴" is an alias of Ray Du, "Dr. Pimple Popper" of Sandra
// Lee), and the person must carry a creator tag, so a namesake never brings someone else's
// audience. Among several exact matches (Qloo has three Mark Wiens), the tagged one wins.
export async function findCreatorPerson(title: string, handle: string, trace?: Trace): Promise<QlooEntity | null> {
  const t0 = Date.now();
  const queries = [...new Set([title, handle.replace(/^@/, '')].filter((q) => q && q.trim()))];
  let chosen: any = null;
  let used = '';
  const seen: string[] = [];
  for (const query of queries) {
    const results = await searchEntities(query, ['urn:entity:person'], 5).catch(() => []);
    const exact = results.filter((r) => r?.entity_id && r?.name && namesMatch(query, r));
    seen.push(`“${query}”: ${exact.length ? exact.map((r) => `${r.name}${isCreator(r) ? ' (creator)' : ''}`).join(', ') : 'no exact match'}`);
    chosen = exact.find(isCreator) ?? null;
    if (chosen) {
      used = query;
      break;
    }
  }
  trace?.add({
    stage: 'creator',
    tool: 'Qloo /search',
    input: `The creator in Qloo: a person named like the channel, tagged as a creator`,
    output: seen.join(' · ') || 'Nothing to search for',
    decision: chosen ? `Use ${chosen.name} (${chosen.entity_id}) for audience overlap and audience taste` : 'No creator-tagged person with this exact name; no audience-taste evidence',
    ms: Date.now() - t0,
  });
  if (!chosen) return null;
  return {
    id: chosen.entity_id,
    name: chosen.name,
    type: 'urn:entity:person',
    popularity: typeof chosen.popularity === 'number' ? chosen.popularity : null,
    affinity: null,
    source: 'qloo',
    via: 'search',
    query: used,
    genres: [],
  };
}
