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

const QLOO_BASE = process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com';
const CACHE_MS = 60 * 60 * 1000;
const MIN_REQUEST_GAP_MS = 125; // 8 req/s, under Qloo's 10 req/s limit

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

// /search has properties.short_description; /v2/insights has short_descriptions
// [{ value, language }] in many languages, in no fixed order. English only; none otherwise.
function shortDescription(x: any): string | undefined {
  const p = x?.properties || {};
  const d = p.short_description || p.short_descriptions?.find((s: any) => s?.language === 'en')?.value;
  return typeof d === 'string' && d ? d : undefined;
}

// /search tags carry "tag_id", /v2/insights tags carry "id".
function genresOf(result: any): string[] {
  return (result?.tags || [])
    .map((t: any) => String(t?.tag_id || t?.id || ''))
    .filter((id: string) => id.startsWith('urn:tag:genre:'))
    .map((id: string) => id.slice('urn:tag:genre:'.length));
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

const responseCache = new Map<string, { at: number; data: any }>();
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
export async function qlooFetch(url: string): Promise<{ data: any; http: string }> {
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
      const d: any = await r.json().catch(() => ({}));
      if (r.ok) return { data: d, http: attemptsLabel(seen) };
      const detail = d?.errors?.map((x: any) => x.message).join('; ') || d?.message || `Qloo returned ${r.status}`;
      const retryable = r.status === 429 || r.status >= 500;
      if (!retryable || attempt > 0) {
        const http = attemptsLabel(seen, retryable ? 'gave up after retry' : 'not retried');
        throw Object.assign(Error(detail), { final: true, status: r.status, http });
      }
      if (r.status === 429) {
        const reset = Number(r.headers.get('x-second-ratelimit-reset')) || 1;
        await new Promise((res) => setTimeout(res, reset * 1000));
      }
    } catch (e: any) {
      if (e.final) throw e;
      seen.push(/timeout|abort/i.test(`${e?.name} ${e?.message}`) ? 'timeout' : 'network error');
      if (attempt > 0) throw Object.assign(e, { http: attemptsLabel(seen, 'gave up after retry') });
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
export function namesMatch(query: string, result: any): boolean {
  const q = compact(query);
  if (!q) return false;
  const names = [result?.name, ...(result?.properties?.akas || []).map((a: any) => a?.value)];
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
): Promise<{ data: any; cached: boolean; http: string; tags: QlooTag[] }> {
  const entities = { 'signal.interests.entities': signal.map((e) => e.id).join(',') };
  if (tags.length) {
    try {
      return { ...(await cachedGet('/v2/insights', { ...params, ...entities, 'signal.interests.tags': tags.map((t) => t.id).join(',') })), tags };
    } catch (e: any) {
      if (e?.status !== 400) throw e;
      ctx?.trace.add({
        stage: ctx.stage,
        tool: 'Rule',
        input: `Tag signal for type ${params['filter.type'].replace('urn:entity:', '')}`,
        output: `Qloo rejected it: ${e.message}`,
        decision: 'Skip the tag signal for this type; use the entities alone',
        http: e.http,
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
  const all = (data?.results?.tags || []).filter((t: any) => t?.id && t?.name);
  const kind = (t: any) => String(t.id).split(':')[2];
  const forIt = (t: any) => (forType && (t.parents || []).some((p: any) => p?.type === forType) ? 0 : 1);
  // Genre tags belong to one domain: "cute" is also urn:tag:genre:music:cute, a kind of
  // music, not a look. With `forType`, only that type's genres count; keyword, theme, style
  // and subgenre tags are Qloo's own cross-domain vocabulary.
  const exact = all.filter(
    (t: any) =>
      compact(t.name) === compact(keyword) && TASTE_TAG_KINDS.includes(kind(t)) && (kind(t) !== 'genre' || !forType || forIt(t) === 0)
  );
  const best = [...exact].sort(
    (a: any, b: any) => forIt(a) - forIt(b) || TASTE_TAG_KINDS.indexOf(kind(a)) - TASTE_TAG_KINDS.indexOf(kind(b))
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
        ? `${all.length} tags, no taste tag named “${keyword}”: ${all.slice(0, 3).map((t: any) => `${t.name} (${label(t)})`).join(', ')}`
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

async function cachedGet(path: string, params: Record<string, string>): Promise<{ data: any; cached: boolean; http: string }> {
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
  } catch (e: any) {
    ctx?.trace.add({
      stage: ctx.stage,
      tool,
      input,
      output: `Failed: ${e?.message || e}`,
      decision:
        e?.status === 400
          ? 'Qloo rejected this query; not retried, since the same query gets the same answer'
          : 'Query failed; this is missing data, not an empty result',
      http: e?.http || 'no response',
      ms: Date.now() - t0,
      ok: false,
    });
    throw e;
  }
}

async function search(query: string, types: string[], take: number): Promise<{ results: any[]; cached: boolean; http: string }> {
  const { data, cached, http } = await cachedGet('/search', { query, take: String(take), types: types.join(',') });
  return { results: Array.isArray(data.results) ? data.results : [], cached, http };
}

export async function searchEntities(query: string, types: string[] = TASTE_TYPES, take = 5): Promise<any[]> {
  return (await search(query, types, take)).results;
}

// Resolve a keyword to one Qloo entity, or null when nothing matches by name.
// Among name matches, preferred results win first (e.g. a brand in the requested
// category), then the most popular (e.g. "Apple Inc" over the "Apple" album).
export async function resolveEntity(
  query: string,
  types: string[] = TASTE_TYPES,
  prefer: (result: any) => boolean = () => false,
  ctx?: TraceCtx
): Promise<QlooEntity | null> {
  const t0 = Date.now();
  const input = `“${query}” among ${typeLabel(types)}`;
  const { results, cached, http } = await failTraced(ctx, 'Qloo /search', input, () => search(query, types, 5));
  const matches = results
    .filter((x) => x.entity_id && x.name && namesMatch(query, x))
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
  const label = `Signal: ${signalLabel(signal, tags)} · type ${typeLabel([type])}`;
  const { data, cached, http, tags: used } = await failTraced(ctx, 'Qloo /v2/insights', label, () =>
    insightsGet({ 'filter.type': type, take: String(take), ...extra }, signal, tags, ctx)
  );
  const via = signal.map((e) => e.name).join(', ');
  const entities: QlooEntity[] = (data?.results?.entities || [])
    .filter((x: any) => x.entity_id && x.name)
    .map((x: any) => ({
      id: x.entity_id,
      name: x.name,
      type,
      popularity: typeof x.popularity === 'number' ? x.popularity : null,
      affinity: typeof x.query?.affinity === 'number' ? x.query.affinity : null,
      source: 'qloo' as const,
      via: 'insights' as const,
      query: via,
      genres: genresOf(x),
      description: shortDescription(x),
    }));
  ctx?.trace.add({
    stage: ctx.stage,
    tool: 'Qloo /v2/insights',
    input: `Signal: ${signalLabel(signal, used)} · type ${typeLabel([type])}`,
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

  const scores = new Map<string, number>();
  const failures: Error[] = [];
  await Promise.all(
    [...byType].map(async ([type, group]) => {
      try {
      const t0 = Date.now();
      const ids = [...new Set(group.map((t) => t.id))];
      const label = `Signal: ${signalLabel(signal, tags)} · affinity of ${ids.length} creator ${typeLabel([type])} entities (filter.results.entities)`;
      const { data, cached, http, tags: used } = await failTraced(ctx, 'Qloo /v2/insights', label, () =>
        insightsGet({ 'filter.type': type, 'filter.results.entities': ids.join(','), take: String(ids.length) }, signal, tags, ctx)
      );
      const scored: { name: string; a: number }[] = [];
      for (const x of data?.results?.entities || []) {
        if (x.entity_id && typeof x.query?.affinity === 'number') {
          scores.set(x.entity_id, x.query.affinity);
          scored.push({ name: x.name, a: x.query.affinity });
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
      } catch (e: any) {
        failures.push(e); // already in the trace (failTraced), with its HTTP attempts
      }
    })
  );
  if (byType.size && failures.length === byType.size) throw failures[0];
  return scores;
}
