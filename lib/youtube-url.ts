// Pure helpers shared by the server and the browser (no API keys here).

export const MAX_VIDEOS = 5;
// A channel URL reads this many of its latest uploads instead: more videos name more things.
export const CHANNEL_VIDEOS = 15;

export type ChannelRef = { handle: string } | { id: string };

// "@mkbhd", "youtube.com/@mkbhd/videos" or "youtube.com/channel/UC…". Legacy /c/ and
// /user/ URLs are not supported: YouTube no longer resolves them reliably.
export function parseChannelRef(raw: string): ChannelRef | null {
  const s = raw.trim();
  const bare = s.match(/^@([\w.-]{3,30})$/);
  if (bare) return { handle: bare[1] };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.hostname.replace(/^(www|m)\./, '') !== 'youtube.com') return null;
  const handle = u.pathname.match(/^\/@([\w.-]{3,30})(?:\/|$)/)?.[1];
  if (handle) return { handle };
  const id = u.pathname.match(/^\/channel\/(UC[\w-]{22})(?:\/|$)/)?.[1];
  return id ? { id } : null;
}

export const channelLabel = (c: ChannelRef) => ('handle' in c ? `@${c.handle}` : c.id);

export function parseVideoId(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com') {
    id = u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] || null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}
