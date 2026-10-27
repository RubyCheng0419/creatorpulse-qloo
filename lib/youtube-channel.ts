import { youtube } from '@/lib/creator';
import { compact, searchEntities } from '@/lib/qloo';
import { bypassCache } from '@/lib/request-context';
import type { Trace } from '@/lib/trace';

// Qloo person → YouTube channel, for the "analyze this creator's videos" deep dive.
// Server-only. Qloo has no YouTube link, only other profiles (Instagram, Twitter), so those
// ids and the plain name are tried as YouTube handles. A channel counts only if its title is
// the person's Qloo name or alias, and it has an audience: "@TatiWestbrook" is an empty
// channel with the right title and 6 subscribers. Nothing is guessed beyond that; without a
// match the creator keeps the Qloo score and simply has no deep dive.

const MIN_SUBSCRIBERS = 10_000;
const CACHE_MS = 24 * 60 * 60 * 1000;

export interface YouTubeChannel {
  id: string;
  title: string;
  handle: string; // "@mkbhd"
  url: string;
  subscribers: number | null; // null when the channel hides its count
}

const cache = new Map<string, { at: number; channel: YouTubeChannel | null }>();

export async function findChannel(qlooId: string, name: string, key: string | undefined, trace?: Trace): Promise<YouTubeChannel | null> {
  if (!key) return null;
  const hit = bypassCache() ? undefined : cache.get(qlooId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.channel;

  const t0 = Date.now();
  // The same entity through /search, which (unlike /v2/insights) carries external ids and aliases.
  const found = await searchEntities(name, ['urn:entity:person'], 5, trace && { trace, stage: 'candidates' }, 'external ids for the channel lookup').catch(() => []);
  const result = found.find((x) => x.entity_id === qlooId);
  const names = new Set([name, ...(result?.properties?.akas || []).map((a: any) => a?.value)].filter(Boolean).map((n: string) => compact(n)));
  const external = result?.properties?.external || {};
  const handles = [...new Set([external.instagram?.id, external.twitter?.id, compact(name)].filter((h): h is string => typeof h === 'string' && /^[\w.-]{3,30}$/.test(h)))];

  let channel: YouTubeChannel | null = null;
  const tried: string[] = [];
  let failed = false; // a YouTube error is not "no channel": don't cache it
  for (const handle of handles) {
    const res = await youtube('channels', { part: 'snippet,statistics', forHandle: handle }, key).catch(() => ((failed = true), null));
    const item = res?.items?.[0];
    const subs = item?.statistics?.hiddenSubscriberCount ? null : Number(item?.statistics?.subscriberCount ?? 0);
    const ok = item && names.has(compact(item.snippet?.title || '')) && (subs === null || subs >= MIN_SUBSCRIBERS);
    tried.push(`@${handle}: ${item ? `“${item.snippet?.title}”${subs !== null ? `, ${subs.toLocaleString('en-US')} subscribers` : ''}${ok ? '' : ' (rejected)'}` : 'none'}`);
    if (ok) {
      const h = item.snippet?.customUrl || `@${handle}`;
      channel = { id: item.id, title: item.snippet.title, handle: h, url: `https://www.youtube.com/${h.startsWith('@') ? h : `channel/${item.id}`}`, subscribers: subs };
      break;
    }
  }
  trace?.add({
    stage: 'candidates',
    tool: 'YouTube channels.list',
    input: `Channel for ${name}: Qloo’s Instagram/Twitter ids and the name as handles`,
    output: tried.join(' · ') || 'No handles to try',
    decision: channel ? `Use ${channel.handle} for the video deep dive` : 'No channel whose title is this person’s name; no deep dive, the Qloo score stands',
    ms: Date.now() - t0,
  });
  if (!failed || channel) cache.set(qlooId, { at: Date.now(), channel });
  return channel;
}
