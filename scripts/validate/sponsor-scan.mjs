// Validation 2, step 1: real sponsors. For each creator, the domains linked in the latest 15
// videos' descriptions (social, shorteners, stores and the creator's own sites left out), and
// which of them are a Qloo brand by exact name or "The <name>". Keys from .env.local, never printed.
// Usage: node sponsor-scan.mjs <out.json> @handle...
import { readFileSync, writeFileSync } from 'node:fs';
const [out, ...handles] = process.argv.slice(2);
const env = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
const get = (k) => env.match(new RegExp(`^\\s*${k}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm'))?.[1];
const yk = get('YOUTUBE_API_KEY'), qk = get('QLOO_API_KEY');
const NOT_SPONSORS = new Set(['youtube', 'youtu', 'instagram', 'twitter', 'x', 'facebook', 'tiktok', 'twitch', 'discord', 'patreon', 'amzn', 'amazon', 'bit', 'goo', 'linktr', 'threads', 'snapchat', 'reddit', 'pinterest', 'spotify', 'apple', 'google', 'geni', 'smarturl', 'lnk', 'shorturl', 'tinyurl', 'ow', 'go', 'shop', 'store', 'merch', 'teespring', 'bitly', 'ln', 'rebrand', 'link', 'linkin']);
const yt = async (path, params) => (await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key: yk })}`)).json();
const compact = (s) => String(s || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function domainName(host) {
  const p = host.toLowerCase().replace(/^www\./, '').split('.');
  const n = p.length;
  if (n >= 3 && p[n - 1].length === 2 && /^(com|co|org|net|gov|edu|ac)$/.test(p[n - 2])) return p[n - 3];
  return n >= 2 ? p[n - 2] : p[0];
}
async function qlooBrand(label) {
  for (const q of [label, `The ${label}`]) {
    const u = new URL('/search', 'https://hackathon.api.qloo.com');
    u.searchParams.set('query', q); u.searchParams.set('take', '5'); u.searchParams.set('types', 'urn:entity:brand');
    const d = await (await fetch(u, { headers: { 'X-Api-Key': qk } })).json().catch(() => ({}));
    const hit = (d.results || []).find((x) => [x.name, ...(x.properties?.akas || []).map((a) => a?.value)].some((n) => compact(n) === compact(q)));
    if (hit) return { name: hit.name, id: hit.entity_id, popularity: hit.popularity };
  }
  return null;
}
const result = {};
for (const h of handles) {
  const ch = (await yt('channels', { part: 'contentDetails,snippet', forHandle: h.replace(/^@/, '') })).items?.[0];
  if (!ch) { console.log(`${h}: no channel`); continue; }
  const own = new Set([compact(h), compact(ch.snippet.title)]);
  const list = await yt('playlistItems', { part: 'contentDetails', playlistId: ch.contentDetails.relatedPlaylists.uploads, maxResults: '15' });
  const ids = (list.items || []).map((i) => i.contentDetails.videoId);
  const vids = (await yt('videos', { part: 'snippet', id: ids.join(',') })).items || [];
  const count = new Map();
  for (const v of vids) {
    const seen = new Set();
    for (const m of String(v.snippet.description || '').matchAll(/https?:\/\/([^\s/?#]+)/gi)) {
      const d = domainName(m[1]);
      if (d.length < 3 || NOT_SPONSORS.has(d) || own.has(d) || [...own].some((o) => o.includes(d) || d.includes(o))) continue;
      seen.add(d);
    }
    for (const d of seen) count.set(d, (count.get(d) || 0) + 1);
  }
  const sponsors = [];
  for (const [d, n] of [...count].sort((a, b) => b[1] - a[1])) {
    const brand = await qlooBrand(d);
    sponsors.push({ domain: d, videos: n, brand });
  }
  result[h] = { title: ch.snippet.title, videos: vids.length, sponsors };
  console.log(`\n${h} (${ch.snippet.title}, ${vids.length} videos):`);
  for (const s of sponsors) console.log(`  ${s.domain} ×${s.videos} → ${s.brand ? `${s.brand.name} (pop ${s.brand.popularity?.toFixed(2)})` : 'not a Qloo brand'}`);
}
writeFileSync(out, JSON.stringify(result, null, 1));
