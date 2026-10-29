// Shared Qloo helpers. Only the server should import this file.
//
// Verified against hackathon.api.qloo.com on 2026-10-25:
// - GET /search?query=...&take=N&types=urn:entity:brand,...  (header: X-Api-Key)
// - response: { results: [{ entity_id, name, types[], popularity, properties.akas[], ... }] }
// - /search returns popularity, not affinity. Affinity only comes from insights.
// - GET /v2/insights?filter.type=...&signal.interests.entities=<ids>&take=N
//   response: { results: { entities: [{ entity_id, name, popularity, tags, query.affinity }] } }
//   filter.type is required. filter.results.entities=<ids> scores exactly those entities.
// - GET /v2/tags?filter.query=...&take=N → { results: { tags: [{ id, name, type, parents }] } }
//   (plain `query` is rejected with 400).
// - signal.interests.tags=<tag ids> is accepted next to signal.interests.entities for every
//   entity type used here (brand, artist, movie, tv_show, destination, place, book,
//   podcast, videogame, person), including with filter.results.entities (2026-10-25).
// - Rate limit: 10 requests/second, 50,000/month (x-second-ratelimit-*, x-month-ratelimit-*).
// - Matching is fuzzy: "iPhone" restricted to brands returns "Strava", so every
//   result must pass namesMatch() before it can be used as evidence.

import { bypassCache } from '@/lib/request-context';
import type { Trace, TraceStage } from '@/lib/trace';
import { errorMessage, caught } from '@/lib/errors';

const QLOO_BASE = process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com';
const CACHE_MS = 60 * 60 * 1000;
const MIN_REQUEST_GAP_MS = 125; // 8 req/s, under Qloo's 10 req/s limit
const MAX_TAKE = 50; // Qloo rejects take above 50 with a 400

export interface QlooEntity {
  id: string; // Qloo entity_id, stored as returned
  name: string;
  type: string; // first Qloo type, e.g. "urn:entity:brand"
  popularity: number | null;
  affinity: number | null; // only insights returns affinity; null for /search results
  source: 'qloo';
  via: 'search' | 'insights';
  query: string; // evidence chain: the keyword (search) or signal entity name (insights)
  genres: string[]; // Qloo genre tags without "urn:tag:genre:", e.g. "brand:electronics:phones_and_tablets"
  description?: string; // Qloo's short description, when insights returns one (people do)
}

// Qloo's JSON as far as this app reads it. Any field can be missing, and endpoints differ:
// /search tags carry "tag_id" and /v2/insights tags "id"; /search and /entities answer
// results as a list, /v2/insights as { entities }, /v2/tags as { tags }, compare as { tags, a, b }.
export interface RawTag {
  id?: string;
  tag_id?: string;
  name?: string;
  type?: string;
  parents?: { type?: string }[];
  query?: { score?: number; count?: string | number };
}
export interface RawEntity {
  entity_id?: string;
  name?: string;
  popularity?: number;
  disambiguation?: string;
  types?: string[] | string;
  tags?: RawTag[];
  properties?: {
    akas?: { value?: string }[];
    short_description?: string;
    short_descriptions?: { value?: string; language?: string }[];
    external?: Record<string, { id?: string } | undefined>;
    industry?: unknown;
  };
  query?: { affinity?: number; explainability?: Record<string, { entity_id?: string; score?: number }[]> };
}
export interface QlooJson {
  results?: RawEntity[] | { entities?: RawEntity[]; tags?: RawTag[]; a?: RawTag[]; b?: RawTag[] };
  errors?: { message?: string }[];
  message?: string;
}
// A result with the two fields every use needs.
export type Named = RawEntity & { entity_id: string; name: string };
const resultList = (d: QlooJson): RawEntity[] => (Array.isArray(d.results) ? d.results : []);
const resultFields = (d: QlooJson) => (d.results && !Array.isArray(d.results) ? d.results : {});

// /search has properties.short_description; /v2/insights has short_descriptions
// [{ value, language }] in many languages, in no fixed order. English only; none otherwise.
function shortDescription(x: RawEntity): string | undefined {
  const p = x?.properties || {};
  const d = p.short_description || p.short_descriptions?.find((s) => s?.language === 'en')?.value;
  return typeof d === 'string' && d ? d : undefined;
}

// /search tags carry "tag_id", /v2/insights tags carry "id".
function genresOf(result: RawEntity): string[] {
  return (result?.tags || [])
    .map((t) => String(t?.tag_id || t?.id || ''))
    .filter((id) => id.startsWith('urn:tag:genre:'))
    .map((id) => id.slice('urn:tag:genre:'.length));
}

// Local businesses dominate fuzzy matches for product names, so places are excluded.
export const TASTE_TYPES = [
  'urn:entity:brand',
  'urn:entity:artist',
  'urn:entity:movie',
  'urn:entity:tv_show',
  'urn:entity:book',
  'urn:entity:podcast',
  'urn:entity:videogame',
  'urn:entity:destination',
  'urn:entity:person',
];

// Cross-domain types for a brand's cultural proxies, covering PRODUCT_SPEC §5.1's
// five dimensions (places are restaurants/hotels, i.e. food & travel).
export const PROXY_TYPES = [
  'urn:entity:brand',
  'urn:entity:artist',
  'urn:entity:movie',
  'urn:entity:tv_show',
  'urn:entity:destination',
  'urn:entity:place',
];

const responseCache = new Map<string, { at: number; data: QlooJson }>();
let nextSlot = 0;

// Spaces out request starts across all concurrent callers in this process.
async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_REQUEST_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

// Every attempt's outcome, joined: "200", "429 → 200 (retried)", "timeout → timeout (gave up after retry)".
const attemptsLabel = (seen: string[], end?: string) =>
  seen.join(' → ') + (end ? ` (${end})` : seen.length > 1 ? ' (retried)' : '');

// Returns the data and how it was obtained; a thrown error carries `http` the same way.
export async function qlooFetch(url: string): Promise<{ data: QlooJson; http: string }> {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw Error('QLOO_API_KEY is not set. Check .env.local.');

  // Retry once on network errors, timeouts, 429 and 5xx (PRODUCT_SPEC §3.2).
  const seen: string[] = [];
  for (let attempt = 0; ; attempt++) {
    await throttle();
    try {
      const r = await fetch(url, {
        headers: { 'X-Api-Key': key, accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      seen.push(String(r.status));
      const d: QlooJson = await r.json().catch(() => ({}));
      if (r.ok) return { data: d, http: attemptsLabel(seen) };
      const detail = d?.errors?.map((x) => x.message).join('; ') || d?.message || `Qloo returned ${r.status}`;
      const retryable = r.status === 429 || r.status >= 500;
      if (!retryable || attempt > 0) {
        const http = attemptsLabel(seen, retryable ? 'gave up after retry' : 'not retried');
        throw Object.assign(Error(detail), { final: true, status: r.status, http });
      }
      if (r.status === 429) {
        const reset = Number(r.headers.get('x-second-ratelimit-reset')) || 1;
        await new Promise((res) => setTimeout(res, reset * 1000));
      }
    } catch (e) {
      const err = caught(e);
      if (err.final) throw e;
      seen.push(/timeout|abort/i.test(`${err.name} ${err.message}`) ? 'timeout' : 'network error');
      if (attempt > 0) throw Object.assign(e instanceof Error ? e : Error(errorMessage(e)), { http: attemptsLabel(seen, 'gave up after retry') });
      // A dropped connection retried at once mostly fails again (seen in the Agent Trace).
      await new Promise((res) => setTimeout(res, 750));
    }
  }
}

function normalize(s: string): string {
  return s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Spacing and punctuation can't make two names different things: "lelabo" = "Le Labo".
export function compact(s: string): string {
  return normalize(s).replace(/ /g, '');
}

// The keyword must equal the entity name or one of Qloo's own aliases (akas).
// Containment is deliberately not accepted: it matched "flying" to Flying Lotus.
// Aliases still cover "Apple" → Apple Inc. Chinese names are unreliable: "蘋果" and
// "耐吉" are not in the aliases and "華碩" returns unrelated brands, so use English names.
export function namesMatch(query: string, result: RawEntity): boolean {
  const q = compact(query);
  if (!q) return false;
  const names = [result?.name, ...(result?.properties?.akas || []).map((a) => a?.value)];
  return names.some((n) => typeof n === 'string' && compact(n) === q);
}


// A Qloo tag used as brand-side signal. Only ids returned by GET /v2/tags are used,
// never free text.
export interface QlooTag {
  id: string; // e.g. "urn:tag:genre:music:minimalism"
  name: string;
  query: string; // the keyword that found it
}

// /v2/insights with the signal. Tags were accepted for every type when tested; should Qloo
// reject them for a type (400), that type is asked again without tags, and the trace says so.
async function insightsGet(
  params: Record<string, string>,
  signal: QlooEntity[],
  tags: QlooTag[],
  ctx?: TraceCtx
): Promise<{ data: QlooJson; cached: boolean; http: string; tags: QlooTag[] }> {
  const entities = { 'signal.interests.entities': signal.map((e) => e.id).join(',') };
  if (tags.length) {
    try {
      return { ...(await cachedGet('/v2/insights', { ...params, ...entities, 'signal.interests.tags': tags.map((t) => t.id).join(',') })), tags };
    } catch (e) {
      if (caught(e).status !== 400) throw e;
      ctx?.trace.add({
        stage: ctx.stage,
        tool: 'Rule',
        input: `Tag signal for type ${params['filter.type'].replace('urn:entity:', '')}`,
        output: `Qloo rejected it: ${errorMessage(e)}`,
        decision: 'Skip the tag signal for this type; use the entities alone',
        http: caught(e).http,
      });
    }
  }
  return { ...(await cachedGet('/v2/insights', { ...params, ...entities })), tags: [] };
}

// Tag kinds that describe taste. Others are not used even when the name matches:
// "perfume" exactly names urn:tag:occupation:wikidata:perfume, and place amenities abound.
// In order of preference for a brand's style word: Qloo's own keyword and theme tags are
// the most general ("cats" → keyword:qloo:cats rather than genre:media:cats).
const TASTE_TAG_KINDS = ['keyword', 'theme', 'style', 'genre', 'subgenre'];

// A Qloo taste tag whose name is exactly the keyword, or null. Like entities, a near match
// is not accepted: "streetwear" finds only "Streetwear Culture Influence", which is not used.
// `forType` prefers tags Qloo attaches to that entity type (its `parents`): for a brand,
// "casual" is genre:brand:fashion:casual, not the place-ambience or podcast tag of that name.
export async function findTag(keyword: string, ctx?: TraceCtx, forType?: string): Promise<QlooTag | null> {
  const t0 = Date.now();
  const { data, cached, http } = await failTraced(ctx, 'Qloo /v2/tags', `“${keyword}”`, () =>
    cachedGet('/v2/tags', { 'filter.query': keyword, take: '20' })
  );
  const all = (resultFields(data).tags || []).filter((t): t is RawTag & { id: string; name: string } => Boolean(t?.id && t?.name));
  const kind = (t: { id: string }) => String(t.id).split(':')[2];
  const forIt = (t: RawTag) => (forType && (t.parents || []).some((p) => p?.type === forType) ? 0 : 1);
  // Genre tags belong to one domain: "cute" is also urn:tag:genre:music:cute, a kind of
  // music, not a look. With `forType`, only that type's genres count; keyword, theme, style
  // and subgenre tags are Qloo's own cross-domain vocabulary.
  const exact = all.filter(
    (t) =>
      compact(t.name) === compact(keyword) && TASTE_TAG_KINDS.includes(kind(t)) && (kind(t) !== 'genre' || !forType || forIt(t) === 0)
  );
  const best = [...exact].sort(
    (a, b) => forIt(a) - forIt(b) || TASTE_TAG_KINDS.indexOf(kind(a)) - TASTE_TAG_KINDS.indexOf(kind(b))
  )[0];
  // "genre:music" rather than "genre", so a rejected genre shows which domain it belongs to.
  const label = (t: { id: string }) => (kind(t) === 'genre' ? String(t.id).split(':').slice(2, 4).join(':') : kind(t));
  ctx?.trace.add({
    stage: ctx.stage,
    tool: 'Qloo /v2/tags',
    input: `“${keyword}”`,
    output: best
      ? `${best.name} (${best.id}), exact name match`
      : all.length
        ? `${all.length} tags, no taste tag named “${keyword}”: ${all.slice(0, 3).map((t) => `${t.name} (${label(t)})`).join(', ')}`
        : 'No tags',
    decision: best ? 'Accepted as tag signal' : 'Rejected: no exact taste-tag match, not used',
    cached,
    http,
    ms: Date.now() - t0,
  });
  return best ? { id: best.id, name: best.name, query: keyword } : null;
}

function signalLabel(signal: QlooEntity[], tags: QlooTag[]): string {
  const names = signal.map((e) => e.name);
  const entities = names.length > 3 ? `${names.length} entities (${names.slice(0, 3).join(', ')}…)` : names.join(', ');
  const tagList = `tags ${tags.map((t) => t.name).join(', ')}`;
  if (!tags.length) return entities;
  return entities ? `${entities} + ${tagList}` : tagList;
}

// Where a traced call belongs in the Agent Trace.
export interface TraceCtx {
  trace: Trace;
  stage: TraceStage;
}

const typeLabel = (types: string[]) => types.map((t) => t.replace('urn:entity:', '')).join('/');
const fmt = (a: number) => a.toFixed(2);

async function cachedGet(path: string, params: Record<string, string>): Promise<{ data: QlooJson; cached: boolean; http: string }> {
  const u = new URL(path, QLOO_BASE);
  for (const [k, v] of Object.entries(params)) if (v !== '') u.searchParams.set(k, v);
  const url = u.toString();
  const hit = bypassCache() ? undefined : responseCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return { data: hit.data, cached: true, http: 'cache' };
  const { data, http } = await qlooFetch(url);
  responseCache.set(url, { at: Date.now(), data });
  return { data, cached: false, http };
}

// Records a Qloo query that failed (with its HTTP attempts) before passing the error on,
// so a failure never looks like "Qloo returned nothing".
async function failTraced<T>(ctx: TraceCtx | undefined, tool: string, input: string, run: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    return await run();
  } catch (e) {
    ctx?.trace.add({
      stage: ctx.stage,
      tool,
      input,
      output: `Failed: ${errorMessage(e)}`,
      decision:
        caught(e).status === 400
          ? 'Qloo rejected this query; not retried, since the same query gets the same answer'
          : 'Query failed; this is missing data, not an empty result',
      http: caught(e).http || 'no response',
      ms: Date.now() - t0,
      ok: false,
    });
    throw e;
  }
}

async function search(query: string, types: string[], take: number): Promise<{ results: RawEntity[]; cached: boolean; http: string }> {
  const { data, cached, http } = await cachedGet('/search', { query, take: String(take), types: types.join(',') });
  return { results: resultList(data), cached, http };
}

// Raw /search results. With a trace, the call is recorded with its HTTP attempts (a failure
// through failTraced, then passed on for the caller to skip), like every other Qloo call.
export async function searchEntities(query: string, types: string[] = TASTE_TYPES, take = 5, ctx?: TraceCtx, why = ''): Promise<RawEntity[]> {
  const t0 = Date.now();
  const input = `“${query}” among ${typeLabel(types)}${why ? ` (${why})` : ''}`;
  const { results, cached, http } = await failTraced(ctx, 'Qloo /search', input, () => search(query, types, take));
  ctx?.trace.add({
    stage: ctx.stage,
    tool: 'Qloo /search',
    input,
    output: results.length ? `${results.length} results: ${results.slice(0, 3).map((x) => x.name).join(', ')}` : 'No results',
    cached,
    http,
    ms: Date.now() - t0,
  });
  return results;
}

// Resolve a keyword to one Qloo entity, or null when nothing matches by name.
// Among name matches, preferred results win first (e.g. a brand in the requested
// category), then the most popular (e.g. "Apple Inc" over the "Apple" album).
export async function resolveEntity(
  query: string,
  types: string[] = TASTE_TYPES,
  prefer: (result: RawEntity) => boolean = () => false,
  ctx?: TraceCtx
): Promise<QlooEntity | null> {
  const t0 = Date.now();
  const input = `“${query}” among ${typeLabel(types)}`;
  const { results, cached, http } = await failTraced(ctx, 'Qloo /search', input, () => search(query, types, 5));
  const matches = results
    .filter((x): x is Named => Boolean(x.entity_id && x.name && namesMatch(query, x)))
    .sort((a, b) => Number(prefer(b)) - Number(prefer(a)) || (b.popularity ?? 0) - (a.popularity ?? 0));
  const best = matches[0];

  if (ctx) {
    if (best) {
      const how = compact(best.name) === compact(query) ? 'name' : 'Qloo alias';
      ctx.trace.add({
        stage: ctx.stage,
        tool: 'Qloo /search',
        input,
        output: `${best.name} (${best.entity_id}), exact ${how} match`,
        decision: matches.length > 1 ? `Accepted: most popular of ${matches.length} exact matches` : 'Accepted as evidence',
        cached,
        http,
        ms: Date.now() - t0,
      });
    } else {
      ctx.trace.add({
        stage: ctx.stage,
        tool: 'Qloo /search',
        input,
        output: results.length ? `${results.length} results, none named “${query}”: ${results.slice(0, 3).map((x) => x.name).join(', ')}` : 'No results',
        decision: 'Rejected: no exact name or alias match, not used',
        cached,
        http,
        ms: Date.now() - t0,
      });
    }
  }

  if (!best) return null;
  return {
    id: best.entity_id,
    name: best.name,
    type: Array.isArray(best.types) ? best.types[0] : String(best.types || ''),
    popularity: typeof best.popularity === 'number' ? best.popularity : null,
    affinity: null,
    source: 'qloo',
    via: 'search',
    query,
    genres: genresOf(best),
  };
}

// GET /entities: Qloo's own record of the entities /search confirmed. The name or an alias
// must still equal the keyword that found it (the same exact rule, against the canonical
// record), and its popularity replaces the search result's. If the call fails, the /search
// matches stand and the trace says they are unverified: missing data, not a mismatch.
// The parts of Qloo's raw JSON that the functions below read.
// The term Qloo matched: "甄嬛傳 → Empresses in the Palace" (an English name) and
// "Dell → Dell Inc" (a retry) were matched by the part after the last arrow.
const searchedTerm = (query: string) => query.split(' → ').pop()!;

export async function verifyEntities(entities: QlooEntity[], ctx?: TraceCtx): Promise<{ kept: QlooEntity[]; dropped: QlooEntity[] }> {
  if (!entities.length) return { kept: entities, dropped: [] };
  const ids = [...new Set(entities.map((e) => e.id))];
  const input = `Re-check ${ids.length} /search-confirmed entit${ids.length === 1 ? 'y' : 'ies'}: ${entities.map((e) => e.name).join(', ')}`;
  const t0 = Date.now();
  let got: Awaited<ReturnType<typeof cachedGet>>;
  try {
    got = await failTraced(ctx, 'Qloo /entities', input, () => cachedGet('/entities', { entity_ids: ids.join(',') }));
  } catch {
    ctx?.trace.add({ stage: ctx.stage, tool: 'Rule', input, output: 'GET /entities failed', decision: 'Keep the /search matches, unverified' });
    return { kept: entities, dropped: [] };
  }
  const results = resultList(got.data);
  const byId = new Map(results.filter((x) => x?.entity_id).map((x) => [x.entity_id!, x]));
  const kept: QlooEntity[] = [];
  const dropped: QlooEntity[] = [];
  const absent: string[] = [];
  for (const e of entities) {
    const x = byId.get(e.id);
    if (!x) {
      absent.push(e.name);
      kept.push(e);
    } else if (!namesMatch(searchedTerm(e.query), x)) dropped.push(e);
    else kept.push({ ...e, popularity: typeof x.popularity === 'number' ? x.popularity : e.popularity });
  }
  ctx?.trace.add({
    stage: ctx.stage,
    tool: 'Qloo /entities',
    input,
    output:
      `${kept.length - absent.length} re-verified by exact name or alias · popularity ${kept
        .filter((e) => e.popularity !== null)
        .map((e) => `${e.name} ${e.popularity!.toFixed(3)}`)
        .join(', ')}` + (absent.length ? ` · not returned: ${absent.join(', ')}` : ''),
    decision: dropped.length
      ? `Drop ${dropped.map((e) => `${e.name} (“${e.query}”)`).join(', ')}: Qloo’s record doesn’t match the keyword by name or alias`
      : absent.length
        ? 'Keep the ones not returned on the strength of /search, unverified'
        : 'All kept',
    cached: got.cached,
    http: got.http,
    ms: Date.now() - t0,
  });
  return { kept, dropped };
}

// Discovery-style /v2/insights calls (a creator's cross-domain expansion, a creator's audience
// taste, the brand's cultural proxies) leave out entities below this Qloo popularity:
// destinations came back as obscure as 0.009 (checked 2026-10-27). Never applied when scoring
// (filter.results.entities), where it would drop entities the videos named.
export const EXPANSION_POPULARITY_MIN = 0.5;

// Parameters for those calls. Checked on 2026-10-27 for every filter.type CreatorPulse uses
// (brand, artist, movie, TV show, destination, place, person): each took effect, none was
// silently ignored.
export function expansionParams(exclude: string[] = []): Record<string, string> {
  return {
    'filter.popularity.min': String(EXPANSION_POPULARITY_MIN),
    'feature.explainability': 'true',
    ...(exclude.length ? { 'filter.exclude.entities': [...new Set(exclude)].join(',') } : {}),
  };
}

// The trace's account of the extra parameters, so the run shows what was filtered.
function extraLabel(extra: Record<string, string>): string {
  const parts: string[] = [];
  if (extra['filter.popularity.min']) parts.push(`popularity ≥ ${extra['filter.popularity.min']}`);
  if (extra['filter.exclude.entities']) parts.push(`excluding ${extra['filter.exclude.entities'].split(',').length} brand-side`);
  if (extra['feature.explainability']) parts.push('explainability');
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

// GET /v2/analysis/compare between the brand side (A) and the creator's confirmed entities
// (B). Qloo compares the two sides' tags; it returns no affinity, so it is reported next to
// the Fit Score as an independent cross-check and never feeds it.
export interface TagComparison {
  brandEntities: string[];
  creatorEntities: string[];
  shared: { id: string; name: string; score: number }[]; // tags both sides carry, with Qloo's score
  brandTags: { id: string; name: string; count: number }[];
  creatorTags: { id: string; name: string; count: number }[];
}

export async function compareTags(a: QlooEntity[], b: QlooEntity[], ctx?: TraceCtx): Promise<TagComparison> {
  const t0 = Date.now();
  const input = `A (brand side): ${a.map((e) => e.name).join(', ')} · B (creator): ${b.length} confirmed entities`;
  const { data, cached, http } = await failTraced(ctx, 'Qloo /v2/analysis/compare', input, () =>
    cachedGet('/v2/analysis/compare', {
      'a.signal.interests.entities': a.map((e) => e.id).join(','),
      'b.signal.interests.entities': b.map((e) => e.id).join(','),
    })
  );
  const r = resultFields(data);
  const tagOf = (x: RawTag) => ({ id: String(x.tag_id || ''), name: String(x.name || '') });
  const shared = (r.tags || [])
    .filter((x) => x?.tag_id && typeof x.query?.score === 'number')
    .map((x) => ({ ...tagOf(x), score: x.query!.score! }))
    .sort((p, q) => q.score - p.score)
    .slice(0, 6);
  const side = (list: RawTag[] = []) => list.filter((x) => x?.tag_id).map((x) => ({ ...tagOf(x), count: Number(x.query?.count) || 0 })).slice(0, 6);
  const out: TagComparison = { brandEntities: a.map((e) => e.name), creatorEntities: b.map((e) => e.name), shared, brandTags: side(r.a), creatorTags: side(r.b) };
  ctx?.trace.add({
    stage: ctx.stage,
    tool: 'Qloo /v2/analysis/compare',
    input,
    output: shared.length ? `${shared.length} shared tags: ${shared.map((t) => `${t.name} ${fmt(t.score)}`).join(', ')}` : 'No shared tags',
    decision: 'Reported as an independent cross-check; not part of the Fit Score',
    cached,
    http,
    ms: Date.now() - t0,
  });
  return out;
}

// Cross-domain entities Qloo associates with the signal entities, with affinity.
export async function getInsights(
  signal: QlooEntity[],
  type: string,
  take = 5,
  ctx?: TraceCtx,
  tags: QlooTag[] = [],
  extra: Record<string, string> = {} // more /v2/insights parameters, e.g. filter.tags
): Promise<QlooEntity[]> {
  const t0 = Date.now();
  const label = `Signal: ${signalLabel(signal, tags)} · type ${typeLabel([type])}${extraLabel(extra)}`;
  const { data, cached, http, tags: used } = await failTraced(ctx, 'Qloo /v2/insights', label, () =>
    insightsGet({ 'filter.type': type, take: String(take), ...extra }, signal, tags, ctx)
  );
  const via = signal.map((e) => e.name).join(', ');
  // With feature.explainability, Qloo scores how much each signal entity contributed; the
  // evidence chain then names the strongest contributors first instead of the whole signal.
  const nameOf = new Map(signal.map((e) => [e.id, e.name]));
  const drivers = (x: RawEntity): string => {
    const ex = x.query?.explainability?.['signal.interests.entities'];
    if (signal.length < 2 || !Array.isArray(ex) || !ex.length) return via;
    const names = [...ex]
      .sort((p, q) => (q?.score ?? 0) - (p?.score ?? 0))
      .map((s) => nameOf.get(s?.entity_id ?? ''))
      .filter(Boolean)
      .slice(0, 3);
    return names.length ? names.join(', ') : via;
  };
  const entities: QlooEntity[] = (resultFields(data).entities || [])
    .filter((x): x is Named => Boolean(x.entity_id && x.name))
    .map((x) => ({
      id: x.entity_id,
      name: x.name,
      type,
      popularity: typeof x.popularity === 'number' ? x.popularity : null,
      affinity: typeof x.query?.affinity === 'number' ? x.query.affinity : null,
      source: 'qloo' as const,
      via: 'insights' as const,
      query: drivers(x),
      genres: genresOf(x),
      description: shortDescription(x),
    }));
  ctx?.trace.add({
    stage: ctx.stage,
    tool: 'Qloo /v2/insights',
    input: `Signal: ${signalLabel(signal, used)} · type ${typeLabel([type])}${extraLabel(extra)}`,
    output: entities.length
      ? `${entities.length} entities: ${entities.slice(0, 3).map((e) => `${e.name}${e.affinity !== null ? ` ${fmt(e.affinity)}` : ''}`).join(', ')}${entities.length > 3 ? '…' : ''}`
      : 'No entities',
    cached,
    http,
    ms: Date.now() - t0,
  });
  return entities;
}

// Affinity of specific target entities given the signal entities, e.g. "how much does
// Apple's audience like Tesla?". Qloo requires filter.type, so targets go per type.
// Targets Qloo does not score are absent from the returned map. One type failing (a timeout)
// leaves that type's targets unscored and recorded, instead of sinking the whole score;
// only when every type fails is the error passed on.
export async function scoreEntities(
  signal: QlooEntity[],
  targets: QlooEntity[],
  ctx?: TraceCtx,
  tags: QlooTag[] = []
): Promise<Map<string, number>> {
  const byType = new Map<string, QlooEntity[]>();
  for (const t of targets) byType.set(t.type, [...(byType.get(t.type) || []), t]);
  // With tags alone as signal, Qloo takes about 15 s to score places (brands, artists and
  // destinations take under half a second; measured 2026-10-27), which is the request
  // timeout. Places are left out then, and the trace says so.
  if (!signal.length && tags.length && byType.has('urn:entity:place')) {
    ctx?.trace.add({
      stage: ctx.stage,
      tool: 'Rule',
      input: `${byType.get('urn:entity:place')!.length} place entities to score against a tags-only signal`,
      output: 'Qloo takes about 15 seconds per request for this combination',
      decision: 'Leave places out; Food & Travel is scored from destinations',
    });
    byType.delete('urn:entity:place');
  }

  // Qloo's take is 1–50 (400 otherwise, checked 2026-10-27), and take must cover every target,
  // so a type with more targets is scored in batches of MAX_TAKE.
  const batches: [string, string[]][] = [];
  for (const [type, group] of byType) {
    const unique = [...new Set(group.map((t) => t.id))];
    for (let i = 0; i < unique.length; i += MAX_TAKE) batches.push([type, unique.slice(i, i + MAX_TAKE)]);
  }

  const scores = new Map<string, number>();
  const failures: Error[] = [];
  await Promise.all(
    batches.map(async ([type, ids]) => {
      try {
      const t0 = Date.now();
      const label = `Signal: ${signalLabel(signal, tags)} · affinity of ${ids.length} creator ${typeLabel([type])} entities (filter.results.entities)`;
      const { data, cached, http, tags: used } = await failTraced(ctx, 'Qloo /v2/insights', label, () =>
        insightsGet({ 'filter.type': type, 'filter.results.entities': ids.join(','), take: String(ids.length) }, signal, tags, ctx)
      );
      const scored: { name: string; a: number }[] = [];
      for (const x of resultFields(data).entities || []) {
        if (x.entity_id && typeof x.query?.affinity === 'number') {
          scores.set(x.entity_id, x.query.affinity);
          scored.push({ name: x.name ?? x.entity_id, a: x.query.affinity });
        }
      }
      scored.sort((a, b) => b.a - a.a);
      ctx?.trace.add({
        stage: ctx.stage,
        tool: 'Qloo /v2/insights',
        input: `Signal: ${signalLabel(signal, used)} · affinity of ${ids.length} creator ${typeLabel([type])} entities (filter.results.entities)`,
        output: `${scored.length}/${ids.length} scored: ${scored.slice(0, 4).map((s) => `${s.name} ${fmt(s.a)}`).join(', ')}${scored.length > 4 ? '…' : ''}`,
        decision: scored.length < ids.length ? `${ids.length - scored.length} not scored by Qloo, left out` : undefined,
        cached,
        http,
        ms: Date.now() - t0,
      });
      } catch (e) {
        failures.push(e instanceof Error ? e : Error(errorMessage(e))); // already in the trace (failTraced), with its HTTP attempts
      }
    })
  );
  if (batches.length && failures.length === batches.length) throw failures[0];
  return scores;
}
