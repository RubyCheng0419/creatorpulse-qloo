import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ApiError } from '@/lib/errors';

// Reads the visible text of a brand's own web page, for name extraction. Server-only.
// The URL comes from the user, so the server must not be steered at itself or at a
// private network: https on the default port only, every address the host resolves to
// must be public, redirects are re-checked, and size and time are capped.

const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
export const MAX_PAGE_TEXT = 6000;

function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
}

async function checkUrl(url: URL): Promise<void> {
  if (url.protocol !== 'https:') throw new ApiError('Only https:// brand pages can be read.', 400);
  if (url.username || url.password || (url.port && url.port !== '443')) throw new ApiError('That URL can’t be read.', 400);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new ApiError(`Couldn’t find the site ${host}.`, 400);
  if (addresses.some(privateAddress)) throw new ApiError('That URL points to a private network and can’t be read.', 400);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function meta(html: string, name: string): string {
  const tag = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i'))?.[0] || '';
  return decode(tag.match(/content=["']([^"']*)["']/i)?.[1] || '');
}

function pageText(html: string): string {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const body = decode(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
  return [title, meta(html, 'description'), meta(html, 'og:description'), body]
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_PAGE_TEXT);
}

export async function fetchPageText(raw: string): Promise<{ url: string; text: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ApiError('That isn’t a valid URL.', 400);
  }

  for (let hop = 0; ; hop++) {
    await checkUrl(url);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'text/html,text/plain', 'user-agent': 'CreatorPulse/1.0 (brand page reader)' },
      });
    } catch {
      throw new ApiError(`Couldn’t read ${url.hostname} in time.`, 502);
    }
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new ApiError('That page redirects too many times.', 502);
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) throw new ApiError(`${url.hostname} returned ${res.status}.`, 502);
    if (!/text\/(html|plain)/i.test(res.headers.get('content-type') || '')) throw new ApiError('That URL isn’t a web page.', 400);

    // Stop reading past MAX_BYTES rather than trusting Content-Length.
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size >= MAX_BYTES) {
        await reader.cancel();
        break;
      }
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    return { url: url.toString(), text: pageText(html) };
  }
}
