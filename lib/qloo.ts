// Shared Qloo helpers. Only the server should import this file.
//
// Verified against hackathon.api.qloo.com on 2026-10-25:
// - GET /search?query=...&take=N&types=urn:entity:brand,...  (header: X-Api-Key)
// - response: { results: [{ entity_id, name, types[], popularity, properties.akas[], ... }] }
// - /search returns popularity, not affinity. Affinity only comes from insights.
// - GET /v2/insights?filter.type=...&signal.interests.entities=<ids>&take=N
//   response: { results: { entities: [{ entity_id, name, popularity, tags, query.affinity }] } }
//   filter.type is required. filter.results.entities=<ids> scores exactly those entities.
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

export async function qlooFetch(url: string): Promise<any> {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw Error('QLOO_API_KEY is not set. Check .env.local.');

  // Retry once on network errors, timeouts, 429 and 5xx (PRODUCT_SPEC §3.2).
  for (let attempt = 0; ; attempt++) {
    await throttle();
    try {
      const r = await fetch(url, {
        headers: { 'X-Api-Key': key, accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      const d: any = await r.json().catch(() => ({}));
      if (r.ok) return d;
      const detail = d?.errors?.map((x: any) => x.message).join('; ') || d?.message || `Qloo returned ${r.status}`;
      const retryable = r.status === 429 || r.status >= 500;
      if (!retryable || attempt > 0) throw Object.assign(Error(detail), { final: true });
      if (r.status === 429) {
        const reset = Number(r.headers.get('x-second-ratelimit-reset')) || 1;
        await new Promise((res) => setTimeout(res, reset * 1000));
      }
    } catch (e: any) {
      if (e.final || attempt > 0) throw e;
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


// Where a traced call belongs in the Agent Trace.
export interface TraceCtx {
  trace: Trace;
  stage: TraceStage;
}

const typeLabel = (types: string[]) => types.map((t) => t.replace('urn:entity:', '')).join('/');
const fmt = (a: number) => a.toFixed(2);

async function cachedGet(path: string, params: Record<string, string>): Promise<{ data: any; cached: boolean }> {
  const u = new URL(path, QLOO_BASE);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const url = u.toString();
  const hit = bypassCache() ? undefined : responseCache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return { data: hit.data, cached: true };
  const data = await qlooFetch(url);
  responseCache.set(url, { at: Date.now(), data });
  return { data, cached: false };
}

async function search(query: string, types: string[], take: number): Promise<{ results: any[]; cached: boolean }> {
  const { data, cached } = await cachedGet('/search', { query, take: String(take), types: types.join(',') });
  return { results: Array.isArray(data.results) ? data.results : [], cached };
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
  const { results, cached } = await search(query, types, 5);
  const matches = results
    .filter((x) => x.entity_id && x.name && namesMatch(query, x))
    .sort((a, b) => Number(prefer(b)) - Number(prefer(a)) || (b.popularity ?? 0) - (a.popularity ?? 0));
  const best = matches[0];

  if (ctx) {
    const input = `“${query}” among ${typeLabel(types)}`;
    if (best) {
      const how = compact(best.name) === compact(query) ? 'name' : 'Qloo alias';
      ctx.trace.add({
        stage: ctx.stage,
        tool: 'Qloo /search',
        input,
        output: `${best.name} (${best.entity_id}), exact ${how} match`,
        decision: matches.length > 1 ? `Accepted: most popular of ${matches.length} exact matches` : 'Accepted as evidence',
        cached,
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
export async function getInsights(signal: QlooEntity[], type: string, take = 5, ctx?: TraceCtx): Promise<QlooEntity[]> {
  const t0 = Date.now();
  const { data, cached } = await cachedGet('/v2/insights', {
    'filter.type': type,
    'signal.interests.entities': signal.map((e) => e.id).join(','),
    take: String(take),
  });
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
    }));
  ctx?.trace.add({
    stage: ctx.stage,
    tool: 'Qloo /v2/insights',
    input: `Signal: ${signal.length > 3 ? `${signal.length} entities (${signal.slice(0, 3).map((e) => e.name).join(', ')}…)` : via} · type ${typeLabel([type])}`,
    output: entities.length
      ? `${entities.length} entities: ${entities.slice(0, 3).map((e) => `${e.name}${e.affinity !== null ? ` ${fmt(e.affinity)}` : ''}`).join(', ')}${entities.length > 3 ? '…' : ''}`
      : 'No entities',
    cached,
    ms: Date.now() - t0,
  });
  return entities;
}

// Affinity of specific target entities given the signal entities, e.g. "how much does
// Apple's audience like Tesla?". Qloo requires filter.type, so targets go per type.
// Targets Qloo does not score are absent from the returned map.
export async function scoreEntities(signal: QlooEntity[], targets: QlooEntity[], ctx?: TraceCtx): Promise<Map<string, number>> {
  const byType = new Map<string, QlooEntity[]>();
  for (const t of targets) byType.set(t.type, [...(byType.get(t.type) || []), t]);

  const scores = new Map<string, number>();
  await Promise.all(
    [...byType].map(async ([type, group]) => {
      const t0 = Date.now();
      const ids = [...new Set(group.map((t) => t.id))];
      const { data, cached } = await cachedGet('/v2/insights', {
        'filter.type': type,
        'signal.interests.entities': signal.map((e) => e.id).join(','),
        'filter.results.entities': ids.join(','),
        take: String(ids.length),
      });
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
        input: `Signal: ${signal.map((e) => e.name).join(', ')} · affinity of ${ids.length} creator ${typeLabel([type])} entities (filter.results.entities)`,
        output: `${scored.length}/${ids.length} scored: ${scored.slice(0, 4).map((s) => `${s.name} ${fmt(s.a)}`).join(', ')}${scored.length > 4 ? '…' : ''}`,
        decision: scored.length < ids.length ? `${ids.length - scored.length} not scored by Qloo, left out` : undefined,
        cached,
        ms: Date.now() - t0,
      });
    })
  );
  return scores;
}
