import { ApiError } from '@/lib/errors';
import { GEMINI_MODEL, geminiJson, hasGemini } from '@/lib/gemini';
import { QlooEntity, resolveEntity } from '@/lib/qloo';
import { bypassCache } from '@/lib/request-context';
import type { Trace } from '@/lib/trace';
import type { OnStage } from '@/lib/stages';
import { MAX_VIDEOS, parseVideoId } from '@/lib/youtube-url';

// PRODUCT_SPEC v3.1 §4.1 steps 1–2: YouTube video metadata → keywords → Qloo entities.
// Replaces the old /api/extract. Comments are not fetched (§1.4). Server-only.

const YT_BASE = 'https://www.googleapis.com/youtube/v3';
const VIDEO_CACHE_MS = 24 * 60 * 60 * 1000;

const videoCache = new Map<string, { at: number; item: any }>();

async function youtube(path: string, params: Record<string, string>, key: string): Promise<any> {
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
const KIND_TYPES: Record<string, string[]> = {
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

const MENTION_PROMPT = `You list cultural entities that are explicitly named in YouTube video metadata.
Include brands, products, artists, movies, TV shows, books, podcasts, video games, destinations and public figures.
Rules:
- Only entities whose name actually appears in the text. Never infer, guess or add related entities.
- Use the entity's official English name when the text names it in another language (e.g. 蘋果 → Apple); otherwise copy it as written.
- Skip generic words (review, unboxing, camera, coffee), video formats and the channel itself.
- At most 20 entities.`;

function geminiError(e: any): string {
  const msg = String(e?.message || e);
  if (e?.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) return 'Gemini’s request quota is used up for now';
  if (/abort|timeout/i.test(msg)) return 'Gemini did not answer in time';
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}

// Called on every match, never cached: the demo and every other match run real extraction.
async function extractMentions(videos: any[]): Promise<{ name: string; kind: string }[]> {
  const text = videos
    .map((v, i) => {
      const s = v.snippet || {};
      return `Video ${i + 1}\nTitle: ${s.title || ''}\nTags: ${(s.tags || []).join(', ')}\nDescription: ${String(s.description || '').slice(0, 1500)}`;
    })
    .join('\n\n');
  const d = await geminiJson<{ entities: { name: string; kind: string }[] }>(MENTION_PROMPT, text, MENTION_SCHEMA);

  const seen = new Set<string>();
  return (d.entities || [])
    .map((e) => ({ name: String(e.name || '').trim(), kind: KIND_TYPES[e.kind] ? e.kind : 'brand' }))
    .filter((e) => e.name.length > 1 && !seen.has(e.name.toLocaleLowerCase()) && seen.add(e.name.toLocaleLowerCase()))
    .slice(0, 20);
}

export interface CreatorTaste {
  videos: { videoId: string; title: string; channelId: string; channelTitle: string; categoryId: string; tags: string[] }[];
  channels: { channelId: string; title: string; handle: string; description: string }[];
  keywords: string[];
  // 'unavailable': Gemini failed or is not configured. No guessed keywords are used
  // instead (they produced wrong evidence), so the match gets no score.
  keywordSource: 'gemini' | 'unavailable';
  extractionError?: string;
  entities: QlooEntity[];
  unmatched: string[];
  warnings: string[];
}

// Throws ApiError for bad input, YouTube failures and total Qloo failure.
export async function getCreatorTaste(rawUrls: unknown, onStage?: OnStage, trace?: Trace): Promise<CreatorTaste> {
  const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
  if (!YOUTUBE_API_KEY) throw new ApiError('YOUTUBE_API_KEY is not set. Check .env.local.', 500);

  const urls: string[] = Array.isArray(rawUrls) ? rawUrls.map(String).filter((x) => x.trim()) : [];
  if (urls.length < 1 || urls.length > MAX_VIDEOS) {
    throw new ApiError(`Provide 1 to ${MAX_VIDEOS} YouTube video URLs.`, 400);
  }
  const invalid = urls.filter((u) => !parseVideoId(u));
  if (invalid.length) throw new ApiError('These are not valid YouTube video URLs:', 400, { invalid });

  const warnings: string[] = [];
  const videoIds = [...new Set(urls.map((u) => parseVideoId(u)!))];

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
  let extractionError: string | undefined = hasGemini() ? undefined : 'GEMINI_API_KEY is not set';
  if (hasGemini()) {
    const g0 = Date.now();
    try {
      const mentions = await extractMentions(videos);
      // The prompt asks Gemini to skip these, but it doesn't always: the channel's own
      // name and YouTube itself say nothing about the audience's taste.
      const skip = new Set(['youtube', ...channels.flatMap((c: any) => [c.title, c.handle.replace(/^@/, '')])].map((x) => x.toLocaleLowerCase()));
      const dropped = mentions.filter((m) => skip.has(m.name.toLocaleLowerCase())).map((m) => m.name);
      queries = mentions.filter((m) => !skip.has(m.name.toLocaleLowerCase())).map((m) => ({ keyword: m.name, types: KIND_TYPES[m.kind] }));
      keywordSource = 'gemini';
      trace?.add({
        stage: 'creator',
        tool: `Gemini (${GEMINI_MODEL})`,
        input: `Titles, tags and descriptions of ${videos.length} video${videos.length === 1 ? '' : 's'}: list names explicitly mentioned`,
        output: mentions.length ? `Proposed ${mentions.length}: ${mentions.map((m) => `${m.name} (${m.kind})`).join(', ')}` : 'Proposed none',
        decision: dropped.length
          ? `Dropped ${dropped.join(', ')} (the channel itself or YouTube); ${queries.length} names go to Qloo as search terms`
          : `${queries.length} names go to Qloo as search terms, not as evidence`,
        ms: Date.now() - g0,
      });
    } catch (e: any) {
      extractionError = geminiError(e);
      trace?.add({
        stage: 'creator',
        tool: `Gemini (${GEMINI_MODEL})`,
        input: `Titles, tags and descriptions of ${videos.length} videos`,
        output: `Failed: ${extractionError}`,
        decision: 'Stop: no guessed keywords are used instead, so no score is given',
        ms: Date.now() - g0,
        ok: false,
      });
    }
  }
  if (extractionError) warnings.push(`Name extraction unavailable: ${extractionError}`);

  const keywords = queries.map((q) => q.keyword);
  const resolved: { keyword: string; entity: QlooEntity | null; error?: string }[] = await Promise.all(
    queries.map(async ({ keyword: k, types }) => {
      try {
        return { keyword: k, entity: await resolveEntity(k, types, undefined, trace && { trace, stage: 'creator' }) };
      } catch (e: any) {
        trace?.add({ stage: 'creator', tool: 'Qloo /search', input: `“${k}”`, output: `Failed: ${e.message}`, ok: false });
        return { keyword: k, entity: null, error: e.message as string };
      }
    })
  );

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
    extractionError,
    entities,
    unmatched,
    warnings,
  };
}
