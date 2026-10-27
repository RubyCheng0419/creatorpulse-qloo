import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ApiError } from '@/lib/errors';
import { GEMINI_MODEL, InlineImage, geminiJson, hasGemini } from '@/lib/gemini';
import { GROQ_MODEL, groqJson, hasGroq } from '@/lib/groq';
import { QlooEntity, resolveEntity, searchEntities } from '@/lib/qloo';
import { bypassCache } from '@/lib/request-context';
import type { Trace } from '@/lib/trace';
import type { OnStage } from '@/lib/stages';
import { CHANNEL_VIDEOS, ChannelRef, MAX_VIDEOS, channelLabel, parseChannelRef, parseVideoId } from '@/lib/youtube-url';

// PRODUCT_SPEC v3.1 §4.1 steps 1–2: YouTube video metadata → keywords → Qloo entities.
// Replaces the old /api/extract. Comments are not fetched (§1.4). Server-only.

const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const VIDEO_CACHE_MS = 24 * 60 * 60 * 1000;

const videoCache = new Map<string, { at: number; item: any }>();

export async function youtube(path: string, params: Record<string, string>, key: string): Promise<any> {
  const u = new URL(`${YT_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('key', key);

  // Retry once on network errors, timeouts and 5xx (PRODUCT_SPEC §3.2).
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
      const d: any = await r.json().catch(() => ({}));
      if (r.ok) return d;
      const reason = d?.error?.errors?.[0]?.reason;
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        throw new ApiError('Today’s YouTube API quota is used up. Please try again tomorrow.', 429);
      }
      if (r.status < 500 || attempt > 0) {
        throw new ApiError(d?.error?.message || `YouTube returned ${r.status}`, 502);
      }
    } catch (e) {
      if (e instanceof ApiError || attempt > 0) throw e;
    }
  }
}

// Gemini proposes names explicitly mentioned in the videos, with a kind that narrows
// the Qloo search. Qloo still decides: only exact name/alias matches become entities.
export const KIND_TYPES: Record<string, string[]> = {
  brand: ['urn:entity:brand'],
  product: ['urn:entity:brand'],
  artist: ['urn:entity:artist'],
  movie: ['urn:entity:movie'],
  tv_show: ['urn:entity:tv_show'],
  book: ['urn:entity:book'],
  podcast: ['urn:entity:podcast'],
  videogame: ['urn:entity:videogame', 'urn:entity:brand'],
  destination: ['urn:entity:destination'],
  person: ['urn:entity:person', 'urn:entity:artist'],
};

const MENTION_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: Object.keys(KIND_TYPES) },
        },
        required: ['name', 'kind'],
      },
    },
  },
  required: ['entities'],
};

// The same rules for video metadata and for a brand's own description.
const mentionPrompt = (source: string, skip: string) => `You list cultural entities that are explicitly named in ${source}.
Include brands, products, artists, movies, TV shows, books, podcasts, video games, destinations and public figures.
Rules:
- Only entities whose name actually appears in the text. Never infer, guess or add related entities.
- Use the entity's official English name when the text names it in another language (e.g. 蘋果 → Apple); otherwise copy it as written.
- Skip generic words (review, unboxing, camera, coffee), ${skip}.
- At most 20 entities.`;

const MENTION_PROMPT = mentionPrompt('YouTube video metadata', 'video formats and the channel itself');
const BRAND_MENTION_PROMPT = mentionPrompt('a brand’s own description or website text', 'slogans, product categories and the brand itself');

function llmError(e: any, llm: string): string {
  const msg = String(e?.message || e);
  if (e?.status === 429 || /quota|RESOURCE_EXHAUSTED|rate limit/i.test(msg)) return `${llm}’s request quota is used up for now`;
  if (e?.status === 503) return `${llm} is overloaded right now`;
  if (/abort|timeout/i.test(msg)) return `${llm} did not answer in time`;
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}

export const geminiError = (e: any) => llmError(e, 'Gemini');

// LLM answers are cached for 24 hours per set of videos (or per brand description), so
// repeating a match (or the demo) doesn't spend the Gemini or Groq quota again. Only
// successful answers are cached, "Run live" bypasses the cache, and the Agent Trace
// marks every LLM step live or cached.
const llmCache = new Map<string, { at: number; value: unknown }>();

// Regression runs only (never set in production): LLM_CACHE_FILE keeps the answers on disk,
// with no expiry, so a code change can be compared on the very same names across restarts.
const LLM_CACHE_FILE = process.env.LLM_CACHE_FILE;
if (LLM_CACHE_FILE && existsSync(LLM_CACHE_FILE)) {
  for (const [k, v] of Object.entries(JSON.parse(readFileSync(LLM_CACHE_FILE, 'utf8')))) llmCache.set(k, v as { at: number; value: unknown });
}

export async function cachedAnswer<T>(key: string, call: () => Promise<T>): Promise<{ value: T; cached: boolean; at: number }> {
  const hit = bypassCache() ? undefined : llmCache.get(key);
  if (hit && (LLM_CACHE_FILE || Date.now() - hit.at < VIDEO_CACHE_MS)) return { value: hit.value as T, cached: true, at: hit.at };
  const value = await call();
  const at = Date.now();
  llmCache.set(key, { at, value });
  if (LLM_CACHE_FILE) writeFileSync(LLM_CACHE_FILE, JSON.stringify(Object.fromEntries(llmCache)));
  return { value, cached: false, at };
}

export const cachedNote = (cached: boolean, at: number) => (cached ? ` (cached answer from ${new Date(at).toISOString()})` : '');

type JsonCall = <T>(system: string, user: string, schema: object) => Promise<T>;

// An LLM answer and which LLM gave it.
export interface LlmAnswer<T> {
  value: T;
  llm: 'gemini' | 'groq';
  model: string;
  geminiFailure?: string; // why Groq answered instead of Gemini
}

export const llmLabel = (a: { llm: 'gemini' | 'groq'; model: string }) => `${a.llm === 'groq' ? 'Groq' : 'Gemini'} (${a.model})`;

// Thrown when no LLM could answer; each part is already a readable sentence.
export class ExtractionFailed extends Error {
  geminiFailure: string | undefined;
  groqFailure: string | undefined;
  noFallback: string | undefined; // why Groq wasn't asked
  constructor(geminiFailure: string | undefined, groqFailure: string | undefined, noFallback?: string) {
    super([geminiFailure, groqFailure && `the Groq fallback failed too: ${groqFailure}`].filter(Boolean).join('; '));
    this.geminiFailure = geminiFailure;
    this.groqFailure = groqFailure;
    this.noFallback = noFallback;
  }
}

// Over quota, overloaded or too slow: another model can answer these. The status is
// checked first; the message covers errors that arrive without one ("RESOURCE_EXHAUSTED",
// "UNAVAILABLE", an aborted request). Bad requests and other errors would fail on Groq too.
function quotaOrOverload(e: any): boolean {
  return (
    e?.status === 429 ||
    e?.status === 503 ||
    /quota|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|abort|timeout|timed out/i.test(`${e?.name || ''} ${e?.message || ''}`)
  );
}

// Gemini first. Only when it is over quota (429), overloaded (503) or doesn't answer in time
// is Groq asked, once, with the same prompt and schema.
// Used for every LLM step, so a Gemini outage never stops one step while another goes on.
async function withFallback<T>(ask: (json: JsonCall) => Promise<T>): Promise<LlmAnswer<T>> {
  let geminiFailure: string | undefined;
  if (hasGemini()) {
    try {
      return { value: await ask(geminiJson), llm: 'gemini', model: GEMINI_MODEL };
    } catch (e: any) {
      geminiFailure = geminiError(e);
      if (!quotaOrOverload(e)) throw new ExtractionFailed(geminiFailure, undefined, 'only quota, overload and timeout errors fall back');
      if (!hasGroq()) throw new ExtractionFailed(geminiFailure, undefined, 'GROQ_API_KEY is not set');
    }
  } else {
    geminiFailure = 'GEMINI_API_KEY is not set';
    if (!hasGroq()) throw new ExtractionFailed(geminiFailure, undefined, 'GROQ_API_KEY is not set');
  }
  try {
    return { value: await ask(groqJson), llm: 'groq', model: GROQ_MODEL, geminiFailure };
  } catch (e: any) {
    throw new ExtractionFailed(geminiFailure, llmError(e, 'Groq'));
  }
}

// A readable reason for any LLM failure, with or without the fallback.
export const llmFailure = (e: any) => (e instanceof ExtractionFailed ? e.message : geminiError(e));

type Mentions = { name: string; kind: string }[];

function extractMentions(videos: any[]): Promise<LlmAnswer<Mentions>> {
  // Up to MAX_VIDEOS videos get 1,500 description characters each, as always; a channel's
  // longer list gets less per video so the prompt stays about the same size.
  const perVideo = videos.length > MAX_VIDEOS ? 600 : 1500;
  const text = videos
    .map((v, i) => {
      const s = v.snippet || {};
      return `Video ${i + 1}\nTitle: ${s.title || ''}\nTags: ${(s.tags || []).join(', ')}\nDescription: ${String(s.description || '').slice(0, perVideo)}`;
    })
    .join('\n\n');
  return withFallback((json) => namedEntities(MENTION_PROMPT, text, json));
}

// Names explicitly mentioned in a brand's description or website text (same rules).
export function extractBrandMentions(text: string): Promise<LlmAnswer<Mentions>> {
  return withFallback((json) => namedEntities(BRAND_MENTION_PROMPT, text, json));
}

// Style and culture keywords a brand states about itself. They are only looked up as Qloo
// tags; a keyword with no tag of exactly that name is dropped.
const KEYWORD_PROMPT = `From a brand's own description, website text or product names, list up to 8 taste keywords for the brand's style, aesthetic, motifs or culture (e.g. minimalism, streetwear, whimsical, cats, cartoon, family, vintage, jazz, anime).
Rules:
- First the brand's broad field in one word (fashion, beauty, food, technology, travel…), then its style.
- One or two words each, lowercase, in English; translate when the text is in another language (童趣 → whimsical, 貓 → cats).
- Only what the text says or its product names clearly show. Never guess the brand's audience.
- Skip product categories (shirt, perfume, shoes), quality claims and slogans (premium, sustainable, best, for everyone).`;

const KEYWORD_SCHEMA = {
  type: 'object',
  properties: { keywords: { type: 'array', items: { type: 'string' } } },
  required: ['keywords'],
};

export function extractBrandKeywords(text: string): Promise<LlmAnswer<string[]>> {
  return withFallback(async (json) => {
    const d = await json<{ keywords: string[] }>(KEYWORD_PROMPT, text, KEYWORD_SCHEMA);
    const seen = new Set<string>();
    return (d.keywords || [])
      .map((k) => String(k || '').trim().toLocaleLowerCase())
      .filter((k) => k.length > 1 && !seen.has(k) && seen.add(k))
      .slice(0, 8);
  });
}

// A brand's key visual → style keywords, looked up as Qloo tags like the ones above.
// Weaker evidence than text: an image rarely shows anything Qloo knows by name.
const IMAGE_PROMPT = `This image is a brand's key visual. List up to 5 taste keywords that describe its clearly visible style, aesthetic or culture (e.g. minimalism, streetwear, vintage, anime, surfing).
Rules:
- One or two words each, lowercase, in English.
- Only what is clearly visible. Never guess the brand, its products or its audience.
- Skip product categories (perfume, shoes), generic words (photo, product, logo, model) and colours.`;

// Gemini only: Groq's fallback model doesn't read images. A failure leaves out the image signal.
export async function extractImageKeywords(image: InlineImage): Promise<LlmAnswer<string[]>> {
  const d = await geminiJson<{ keywords: string[] }>(IMAGE_PROMPT, 'List the keywords for this key visual.', KEYWORD_SCHEMA, 0, image);
  const seen = new Set<string>();
  const value = (d.keywords || [])
    .map((k) => String(k || '').trim().toLocaleLowerCase())
    .filter((k) => k.length > 1 && !seen.has(k) && seen.add(k))
    .slice(0, 5);
  return { value, llm: 'gemini', model: GEMINI_MODEL };
}

async function namedEntities(prompt: string, text: string, json: JsonCall): Promise<Mentions> {
  const d = await json<{ entities: { name: string; kind: string }[] }>(prompt, text, MENTION_SCHEMA);

  const seen = new Set<string>();
  return (d.entities || [])
    .map((e) => ({ name: String(e.name || '').trim(), kind: KIND_TYPES[e.kind] ? e.kind : 'brand' }))
    .filter((e) => e.name.length > 1 && !seen.has(e.name.toLocaleLowerCase()) && seen.add(e.name.toLocaleLowerCase()))
    .slice(0, 20);
}

// Retry for names Qloo had no exact match for: Gemini sees each name with Qloo's top
// results and may pick one that is the same thing under another spelling or alias
// ("Dell" → "Dell Inc"). It only chooses a new search term; Qloo must then return
// that very entity by exact name or alias, or nothing is added. Gemini never scores.
const RETRY_PROMPT = `For each name below, decide whether it refers to exactly the same real-world thing as one of its candidate entities: an abbreviation, alias, alternate spelling or translation of that candidate's name.
Rules:
- A product, model or product line is NOT the same as its maker or brand (e.g. "Tesla Roadster" is not "Tesla", "iPhone Duo" is not "Apple Inc").
- A merely related, similarly named or partially matching entity is NOT the same (e.g. "Duo" the phone is not "Duolingo").
- If unsure, answer -1.
Return choice = the candidate's index, or -1 for none, and a one-sentence reason.`;

const RETRY_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, choice: { type: 'integer' }, reason: { type: 'string' } },
        required: ['name', 'choice', 'reason'],
      },
    },
  },
  required: ['decisions'],
};

async function retryUnmatched(
  videoKey: string,
  queries: { keyword: string; types: string[] }[],
  resolved: { keyword: string; entity: QlooEntity | null; error?: string }[],
  trace?: Trace
): Promise<void> {
  // Candidates come from the same cached /search the first attempt made: no extra Qloo calls.
  const pending: { row: (typeof resolved)[number]; types: string[]; candidates: any[] }[] = [];
  for (const row of resolved) {
    if (row.entity || row.error) continue;
    const types = queries.find((q) => q.keyword === row.keyword)!.types;
    const found = await searchEntities(row.keyword, types, 5, trace && { trace, stage: 'creator' }, 'candidates for the retry decision').catch(() => []);
    const candidates = found.filter((x) => x.entity_id && x.name).slice(0, 5);
    if (candidates.length) pending.push({ row, types, candidates });
  }
  if (!pending.length) return;

  const g0 = Date.now();
  // Named after the LLM that answered (Groq when Gemini fell back); Gemini until then.
  let tool = `Gemini retry decision (${GEMINI_MODEL})`;
  const input = `${pending.length} name${pending.length === 1 ? '' : 's'} with no exact Qloo match, each with Qloo’s top results: is any result the same thing under another name?`;
  let decisions: { name: string; choice: number; reason: string }[];
  let retryCached = false;
  let retryAt = 0;
  try {
    const payload = pending.map((p) => ({
      name: p.row.keyword,
      candidates: p.candidates.map((c, i) => ({
        index: i,
        name: c.name,
        type: String(c.types?.[0] || '').replace('urn:entity:', ''),
        note: c.disambiguation || undefined,
      })),
    }));
    // Keyed by the videos and the exact question (names and candidate ids), so a change
    // in Qloo's results asks Gemini again.
    const key = `retry:${videoKey}|${JSON.stringify(pending.map((p) => [p.row.keyword, p.candidates.map((c) => c.entity_id)]))}`;
    const r = await cachedAnswer(key, () =>
      withFallback(
        async (json) => (await json<{ decisions: typeof decisions }>(RETRY_PROMPT, JSON.stringify(payload), RETRY_SCHEMA)).decisions || []
      )
    );
    decisions = r.value.value;
    tool = `${r.value.llm === 'groq' ? 'Groq' : 'Gemini'} retry decision (${r.value.model})`;
    retryCached = r.cached;
    retryAt = r.at;
  } catch (e: any) {
    trace?.add({ stage: 'creator', tool, input, output: `Failed: ${llmFailure(e)}`, decision: 'Keep the first-pass result', ms: Date.now() - g0, ok: false });
    return;
  }

  const picks = pending.map((p) => {
    const d = decisions.find((x) => x.name === p.row.keyword);
    const candidate = d && d.choice >= 0 ? p.candidates[d.choice] : undefined;
    return { ...p, candidate, reason: d?.reason || 'no answer' };
  });
  const chosen = picks.filter((p) => p.candidate);
  trace?.add({
    stage: 'creator',
    tool,
    input,
    output:
      picks.map((p) => `“${p.row.keyword}” → ${p.candidate ? `“${p.candidate.name}”` : 'none'} (${p.reason})`).join(' · ') +
      cachedNote(retryCached, retryAt),
    decision: chosen.length
      ? `Re-query Qloo for ${chosen.map((p) => `“${p.candidate.name}”`).join(', ')}; it counts only if Qloo returns that same entity by exact name or alias`
      : 'No re-query: none of the results is the same thing',
    cached: retryCached,
    ms: Date.now() - g0,
  });

  for (const p of chosen) {
    const entity = await resolveEntity(p.candidate.name, p.types, undefined, trace && { trace, stage: 'creator' });
    const ok = entity?.id === p.candidate.entity_id;
    if (ok) p.row.entity = { ...entity!, query: `${p.row.keyword} → ${p.candidate.name}` };
    trace?.add({
      stage: 'creator',
      tool: 'Rule',
      input: `Verify the Gemini retry for “${p.row.keyword}”`,
      output: ok ? `Qloo confirmed ${entity!.name} (${entity!.id})` : `Qloo did not return ${p.candidate.name} as an exact match`,
      decision: ok ? 'Accepted as evidence' : 'Rejected: not used',
    });
  }
}

export interface CreatorTaste {
  videos: { videoId: string; title: string; channelId: string; channelTitle: string; categoryId: string; tags: string[] }[];
  channels: { channelId: string; title: string; handle: string; description: string }[];
  keywords: string[];
  // Which LLM proposed the names. 'groq' is the fallback when Gemini is over quota or
  // overloaded. 'unavailable': neither answered. No guessed keywords are used instead
  // (they produced wrong evidence), so the match gets no score.
  keywordSource: 'gemini' | 'groq' | 'unavailable';
  extractionModel?: string;
  extractionFallback?: string; // why Gemini didn't answer, when Groq did
  extractionError?: string;
  geminiCached?: boolean; // the extraction (by either LLM) came from the 24-hour cache
  geminiAt?: string; // when that extraction was produced
  entities: QlooEntity[];
  unmatched: string[];
  warnings: string[];
}

// A channel's latest CHANNEL_VIDEOS uploads: channels.list for its uploads playlist, then
// playlistItems.list (1 quota unit each, never search.list).
async function latestUploads(ref: ChannelRef, key: string, trace?: Trace): Promise<string[]> {
  const t0 = Date.now();
  const ch = await youtube('channels', { part: 'contentDetails,snippet', ...('handle' in ref ? { forHandle: ref.handle } : { id: ref.id }) }, key);
  const channel = ch.items?.[0];
  const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) {
    trace?.add({ stage: 'youtube', tool: 'YouTube channels.list', input: channelLabel(ref), output: 'No such channel', ms: Date.now() - t0, ok: false });
    throw new ApiError(`YouTube has no channel ${channelLabel(ref)}.`, 422);
  }
  const list = await youtube('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: String(CHANNEL_VIDEOS) }, key);
  const ids: string[] = (list.items || []).map((x: any) => x.contentDetails?.videoId).filter(Boolean);
  trace?.add({
    stage: 'youtube',
    tool: 'YouTube channels.list + playlistItems.list',
    input: `Channel ${channelLabel(ref)}: latest ${CHANNEL_VIDEOS} uploads`,
    output: `${channel.snippet?.title}: ${ids.length} video IDs`,
    ms: Date.now() - t0,
  });
  if (!ids.length) throw new ApiError(`Channel ${channelLabel(ref)} has no public uploads.`, 422);
  return ids;
}

// Throws ApiError for bad input, YouTube failures and total Qloo failure.
export async function getCreatorTaste(rawUrls: unknown, onStage?: OnStage, trace?: Trace): Promise<CreatorTaste> {
  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
  if (!YOUTUBE_API_KEY) throw new ApiError('YOUTUBE_API_KEY is not set. Check .env.local.', 500);

  const urls: string[] = Array.isArray(rawUrls) ? rawUrls.map(String).filter((x) => x.trim()) : [];
  // One channel URL instead of videos: its latest uploads are read.
  const channelRef = urls.length === 1 && !parseVideoId(urls[0]) ? parseChannelRef(urls[0]) : null;
  if (!channelRef) {
    if (urls.length < 1 || urls.length > MAX_VIDEOS) {
      throw new ApiError(`Provide 1 to ${MAX_VIDEOS} YouTube video URLs, or one channel URL.`, 400);
    }
    const invalid = urls.filter((u) => !parseVideoId(u));
    if (invalid.length) throw new ApiError('These are not valid YouTube video URLs:', 400, { invalid });
  }

  const warnings: string[] = [];
  const videoIds = channelRef
    ? await latestUploads(channelRef, YOUTUBE_API_KEY, trace)
    : [...new Set(urls.map((u) => parseVideoId(u)!))];

  // 1. videos.list (1 quota unit per call; never search.list, which costs 100).
  const t0 = Date.now();
  const items = new Map<string, any>();
  const missing = videoIds.filter((id) => {
    const hit = bypassCache() ? undefined : videoCache.get(id);
    if (hit && Date.now() - hit.at < VIDEO_CACHE_MS) {
      items.set(id, hit.item);
      return false;
    }
    return true;
  });
  if (missing.length) {
    const d = await youtube('videos', { part: 'snippet', id: missing.join(',') }, YOUTUBE_API_KEY);
    for (const item of d.items || []) {
      items.set(item.id, item);
      videoCache.set(item.id, { at: Date.now(), item });
    }
  }

  // Private, deleted and region-blocked videos are simply absent from items.
  videoIds.forEach((id, i) => {
    if (!items.has(id)) warnings.push(`Video ${i + 1} (${id}) could not be read (private, deleted or region-blocked) and was skipped.`);
  });
  const videos = videoIds.filter((id) => items.has(id)).map((id) => items.get(id));
  const skipped = videoIds.length - videos.length;
  trace?.add({
    stage: 'youtube',
    tool: 'YouTube videos.list',
    input: `${videoIds.length} video ID${videoIds.length === 1 ? '' : 's'}`,
    output: `${videos.length} readable: ${videos.map((v) => `“${v.snippet?.title}”`).join(', ')}`,
    decision: skipped ? `Skipped ${skipped} unreadable video${skipped === 1 ? '' : 's'} (private, deleted or region-blocked)` : undefined,
    cached: !missing.length,
    ms: Date.now() - t0,
  });
  if (!videos.length) throw new ApiError('None of the videos could be read. Make sure they are public.', 422, { warnings });

  // 2. channels.list for channel name, handle and description.
  const channelIds = [...new Set(videos.map((v) => v.snippet?.channelId).filter(Boolean))];
  const ch = await (trace
    ? trace.call(
        { stage: 'youtube', tool: 'YouTube channels.list', input: `${channelIds.length} channel ID${channelIds.length === 1 ? '' : 's'}` },
        () => youtube('channels', { part: 'snippet', id: channelIds.join(',') }, YOUTUBE_API_KEY),
        (d) => ({
          output: (d.items || []).map((c: any) => `${c.snippet?.title} (${c.snippet?.customUrl || c.id})`).join(', '),
          cached: false, // channels.list is not cached
        })
      )
    : youtube('channels', { part: 'snippet', id: channelIds.join(',') }, YOUTUBE_API_KEY));
  const channels = (ch.items || []).map((c: any) => ({
    channelId: c.id,
    title: c.snippet?.title || '',
    handle: c.snippet?.customUrl || '',
    description: c.snippet?.description || '',
  }));

  onStage?.('youtube');

  // 3. Keywords → Qloo entities. Only name-matched Qloo results count as evidence.
  // lib/qloo throttles these under Qloo's 10 req/s limit.
  let queries: { keyword: string; types: string[] }[] = [];
  let keywordSource: CreatorTaste['keywordSource'] = 'unavailable';
  let extractionError: string | undefined = hasGemini() || hasGroq() ? undefined : 'GEMINI_API_KEY is not set';
  let extractionModel: string | undefined;
  let extractionFallback: string | undefined;
  let geminiCached: boolean | undefined;
  let geminiAt: string | undefined;
  // The set of readable videos, order-independent: the key for the extraction and retry
  // caches. Whichever LLM answered, its answer is reused for these videos for 24 hours.
  const videoKey = videos.map((v) => v.id).sort().join(',');
  if (!extractionError) {
    const g0 = Date.now();
    try {
      const r = await cachedAnswer(`mentions:${videoKey}`, () => extractMentions(videos));
      const { value: mentions, llm, model, geminiFailure } = r.value;
      extractionModel = model;
      extractionFallback = geminiFailure;
      geminiCached = r.cached;
      geminiAt = new Date(r.at).toISOString();
      if (geminiFailure && !r.cached) {
        trace?.add({
          stage: 'creator',
          tool: `Gemini (${GEMINI_MODEL})`,
          input: `Titles, tags and descriptions of ${videos.length} video${videos.length === 1 ? '' : 's'}`,
          output: `Failed: ${geminiFailure}`,
          decision: 'Ask Groq once, with the same prompt and schema',
          ok: false,
        });
      }
      // The prompt asks Gemini to skip these, but it doesn't always: the channel's own
      // name and YouTube itself say nothing about the audience's taste.
      const skip = new Set(['youtube', ...channels.flatMap((c: any) => [c.title, c.handle.replace(/^@/, '')])].map((x) => x.toLocaleLowerCase()));
      const dropped = mentions.filter((m) => skip.has(m.name.toLocaleLowerCase())).map((m) => m.name);
      queries = mentions.filter((m) => !skip.has(m.name.toLocaleLowerCase())).map((m) => ({ keyword: m.name, types: KIND_TYPES[m.kind] }));
      keywordSource = llm;
      trace?.add({
        stage: 'creator',
        tool: `${llm === 'groq' ? 'Groq' : 'Gemini'} (${model})`,
        input: `Titles, tags and descriptions of ${videos.length} video${videos.length === 1 ? '' : 's'}: list names explicitly mentioned`,
        output:
          (mentions.length ? `Proposed ${mentions.length}: ${mentions.map((m) => `${m.name} (${m.kind})`).join(', ')}` : 'Proposed none') +
          cachedNote(r.cached, r.at),
        decision: dropped.length
          ? `Dropped ${dropped.join(', ')} (the channel itself or YouTube); ${queries.length} names go to Qloo as search terms`
          : `${queries.length} names go to Qloo as search terms, not as evidence`,
        cached: r.cached,
        ms: Date.now() - g0,
      });
    } catch (e: any) {
      const failed = e instanceof ExtractionFailed ? e : new ExtractionFailed(geminiError(e), undefined);
      extractionError = failed.message;
      const input = `Titles, tags and descriptions of ${videos.length} videos`;
      const stop = 'Stop: no guessed keywords are used instead, so no score is given';
      if (failed.geminiFailure) {
        trace?.add({
          stage: 'creator',
          tool: `Gemini (${GEMINI_MODEL})`,
          input,
          output: `Failed: ${failed.geminiFailure}`,
          decision: failed.groqFailure
            ? 'Ask Groq once, with the same prompt and schema'
            : `${stop}${failed.noFallback ? ` (no Groq fallback: ${failed.noFallback})` : ''}`,
          ms: failed.groqFailure ? undefined : Date.now() - g0,
          ok: false,
        });
      }
      if (failed.groqFailure) {
        trace?.add({ stage: 'creator', tool: `Groq (${GROQ_MODEL})`, input, output: `Failed: ${failed.groqFailure}`, decision: stop, ms: Date.now() - g0, ok: false });
      }
    }
  }
  if (extractionError) warnings.push(`Name extraction unavailable: ${extractionError}`);

  const keywords = queries.map((q) => q.keyword);
  const resolved: { keyword: string; entity: QlooEntity | null; error?: string }[] = await Promise.all(
    queries.map(async ({ keyword: k, types }) => {
      try {
        return { keyword: k, entity: await resolveEntity(k, types, undefined, trace && { trace, stage: 'creator' }) };
      } catch (e: any) {
        trace?.add({
          stage: 'creator',
          tool: 'Qloo /search',
          input: `“${k}”`,
          output: `Failed: ${e.message}`,
          decision: 'Skip this name: missing data, not a confirmed non-match',
          http: e?.http || 'no response',
          ok: false,
        });
        return { keyword: k, entity: null, error: e.message as string };
      }
    })
  );
  await retryUnmatched(videoKey, queries, resolved, trace);

  onStage?.('creator');

  const qlooErrors = resolved.filter((x) => x.error);
  if (keywords.length && qlooErrors.length === keywords.length) {
    throw new ApiError(`Qloo lookup failed: ${qlooErrors[0].error}`, 502, { warnings });
  }
  if (qlooErrors.length) {
    warnings.push(
      `${qlooErrors.length} keyword lookups failed in Qloo (${qlooErrors.map((x) => x.keyword).join(', ')}): ${qlooErrors[0].error}`
    );
  }

  const byId = new Map<string, QlooEntity>();
  for (const { entity } of resolved) if (entity && !byId.has(entity.id)) byId.set(entity.id, entity);
  const entities = [...byId.values()];
  const unmatched = resolved.filter((x) => !x.entity && !x.error).map((x) => x.keyword);

  if (!extractionError && entities.length < 3) {
    warnings.push(`Qloo matched only ${entities.length} taste entities, below the scoring minimum of 3.`);
  }

  return {
    videos: videos.map((v) => ({
      videoId: v.id,
      title: v.snippet?.title || '',
      channelId: v.snippet?.channelId || '',
      channelTitle: v.snippet?.channelTitle || '',
      categoryId: v.snippet?.categoryId || '',
      tags: v.snippet?.tags || [],
    })),
    channels,
    keywords,
    keywordSource,
    extractionModel,
    extractionFallback,
    extractionError,
    geminiCached,
    geminiAt,
    entities,
    unmatched,
    warnings,
  };
}
