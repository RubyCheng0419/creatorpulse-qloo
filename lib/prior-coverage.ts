// Prior coverage: whether the videos already read mention the brand. A YouTube-derived signal
// with CreatorPulse's own tier, shown next to the Fit Score and never part of it: the brand
// itself is never scored (lib/match), and a mention says nothing about whether the creator
// likes the brand. Pure text matching on titles, descriptions and tags; no LLM, no Qloo.
// Shared by the server (computed when the videos are read) and the browser.

export type CoveragePlace = 'title' | 'description' | 'tags';
export type CoverageTier = 'High' | 'Medium' | 'None';

export interface CoverageVideo {
  videoId: string;
  title: string;
  url: string;
  publishedAt: string | null;
  viewCount: number | null;
  brandPlaces: CoveragePlace[]; // where the brand name itself appears
  productPlaces: CoveragePlace[]; // where one of its product names appears
  products: string[]; // the product names found
  snippet: { place: CoveragePlace; text: string }; // the first mention, quoted as written
  // "sponsored" / "ad" as they appear in the description, quoted; never inferred.
  sponsorWords?: { word: string; text: string };
}

export interface PriorCoverage {
  videosRead: number;
  brandTerms: string[];
  productTerms: string[];
  mentioning: CoverageVideo[];
  latest: string | null; // publish date of the latest mentioning video
  tier: CoverageTier;
}

// CreatorPulse's definition, stated wherever the tier is shown.
export const HIGH_MENTION_VIDEOS = 3;
export const TIER_DEFINITION = `High: ${HIGH_MENTION_VIDEOS}+ of the videos read mention the brand, or any title does. Medium: 1–2 videos, in descriptions or tags only. None: no mention.`;

// "Apple Inc" is written "Apple" in videos; a company suffix isn't part of how a brand is named.
const SUFFIX = /[\s,]+(inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|llc|plc|gmbh|ag|s\.?a\.?)$/i;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole words for names with Latin letters ("Apple" not in "Pineapple"); a plain substring for
// names in scripts without spaces between words (蘋果).
function termPattern(term: string): RegExp {
  const body = escape(term).replace(/\s+/g, '\\s+');
  return /[a-z0-9]/i.test(term) ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu') : new RegExp(body, 'iu');
}

export function brandTermsOf(...names: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const t = String(n || '').trim().replace(SUFFIX, '').trim();
    if (t.length < 2 || seen.has(t.toLocaleLowerCase())) continue;
    seen.add(t.toLocaleLowerCase());
    out.push(t);
  }
  return out;
}

// A product name counts only when it starts with the brand's name plus more words, the same
// fixed rule that counts a product as its maker (lib/creator): "Garmin Edge 1060" for Garmin.
export function productTermsOf(products: string[], brandTerms: string[]): string[] {
  const out = products.filter((p) => brandTerms.some((b) => p.length > b.length && new RegExp(`^${escape(b)}\\s+\\S`, 'iu').test(p)));
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

// The words around a match, as written, cut at word boundaries.
function around(text: string, index: number, length: number, radius = 70): string {
  const flat = text.replace(/\s+/g, ' ');
  const start = Math.max(0, index - radius);
  const end = Math.min(flat.length, index + length + radius);
  let s = flat.slice(start, end).trim();
  if (start > 0) s = `…${s.replace(/^\S*\s/, '')}`;
  if (end < flat.length) s = `${s.replace(/\s\S*$/, '')}…`;
  return s;
}

// Only these words, only in the description, and only quoted: a mention is never called sponsored.
const SPONSOR = /(?<![\p{L}\p{N}])(sponsored|#ad|ad)(?![\p{L}\p{N}])/iu;

export function priorCoverage(
  videos: { videoId: string; title: string; tags: string[]; publishedAt?: string | null; viewCount?: number | null }[],
  descriptions: Record<string, string>,
  brandTerms: string[],
  productTerms: string[]
): PriorCoverage {
  const brands = brandTerms.map(termPattern);
  const products = productTerms.map((p) => ({ name: p, re: termPattern(p) }));
  const mentioning: CoverageVideo[] = [];
  for (const v of videos) {
    const texts: [CoveragePlace, string][] = [
      ['title', v.title.replace(/\s+/g, ' ')],
      ['description', (descriptions[v.videoId] || '').replace(/\s+/g, ' ')],
      ['tags', v.tags.join(', ')],
    ];
    const brandPlaces: CoveragePlace[] = [];
    const productPlaces: CoveragePlace[] = [];
    const found = new Set<string>();
    let snippet: CoverageVideo['snippet'] | null = null;
    for (const [place, text] of texts) {
      // Product names first, then the brand name in what's left, so "Garmin Edge 1060" is a
      // product mention and not also a brand-name mention.
      let rest = text;
      for (const p of products) {
        const m = p.re.exec(rest);
        if (!m) continue;
        found.add(p.name);
        if (!productPlaces.includes(place)) productPlaces.push(place);
        snippet ??= { place, text: around(text, m.index, m[0].length) };
        rest = rest.replace(new RegExp(p.re.source, 'giu'), (s) => ' '.repeat(s.length));
      }
      for (const re of brands) {
        const m = re.exec(rest);
        if (!m) continue;
        if (!brandPlaces.includes(place)) brandPlaces.push(place);
        snippet ??= { place, text: around(text, m.index, m[0].length) };
        break;
      }
    }
    if (!snippet) continue;
    const description = texts[1][1];
    const sponsor = SPONSOR.exec(description);
    mentioning.push({
      videoId: v.videoId,
      title: v.title,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      publishedAt: v.publishedAt ?? null,
      viewCount: v.viewCount ?? null,
      brandPlaces,
      productPlaces,
      products: [...found],
      snippet,
      ...(sponsor ? { sponsorWords: { word: sponsor[0], text: around(description, sponsor.index, sponsor[0].length, 50) } } : {}),
    });
  }
  const dates = mentioning.map((m) => m.publishedAt).filter((d): d is string => !!d).sort();
  const inTitle = mentioning.some((m) => m.brandPlaces.includes('title') || m.productPlaces.includes('title'));
  const tier: CoverageTier = !mentioning.length ? 'None' : mentioning.length >= HIGH_MENTION_VIDEOS || inTitle ? 'High' : 'Medium';
  return { videosRead: videos.length, brandTerms, productTerms, mentioning, latest: dates.at(-1) ?? null, tier };
}
