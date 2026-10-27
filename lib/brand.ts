import { createHash } from 'node:crypto';
import {
  KIND_TYPES,
  LlmAnswer,
  cachedAnswer,
  cachedNote,
  extractBrandKeywords,
  extractBrandMentions,
  extractImageKeywords,
  llmFailure,
  llmLabel,
} from '@/lib/creator';
import { ApiError } from '@/lib/errors';
import { GEMINI_MODEL, InlineImage } from '@/lib/gemini';
import { bypassCache } from '@/lib/request-context';
import { fetchPageText } from '@/lib/web-page';
import {
  PROXY_TYPES,
  QlooEntity,
  QlooTag,
  compact,
  expansionParams,
  findTag,
  getInsights,
  resolveEntity,
  searchEntities,
  verifyEntities,
} from '@/lib/qloo';
import type { NoDataReason } from '@/lib/no-data';
import { Compatibility, ConfidenceLevel, lowerConfidence } from '@/lib/scoring';
import type { Trace } from '@/lib/trace';

// PRODUCT_SPEC v3.1 §4.1 step 3: brand name → Qloo brand entity → its cultural proxies
// (cross-domain entities Qloo associates with the brand, each with affinity). Server-only.
//
// When Qloo has no such brand (a niche brand), the brand side can instead be built from
// reference brands the user names: brands with a similar audience that are in Qloo.
// Each must pass the same exact-match check as any evidence; nothing is substituted silently.

const PROXIES_PER_TYPE = 5;
export const MAX_REFERENCE_BRANDS = 3;

// UI category → terms matched against Qloo's industry and genre tags.
const CATEGORY_TERMS: Record<string, string[]> = {
  Technology: ['technology', 'electronics', 'software', 'computer'],
  Sports: ['sport', 'athletic', 'fitness'],
  Beauty: ['beauty', 'cosmetic', 'skin care', 'makeup'],
  'Food & Beverage': ['food', 'beverage', 'restaurant'],
  Automotive: ['automotive', 'car', 'vehicle'],
  Fashion: ['fashion', 'apparel', 'clothing', 'luxury'],
};

// Category only breaks ties between brands that already match the name exactly
// (e.g. two brands called "Delta"); it never picks a brand by itself.
function categoryMatcher(category: string): (result: any) => boolean {
  const c = category.trim().toLocaleLowerCase();
  if (!c) return () => false;
  const terms = CATEGORY_TERMS[category.trim()] || [c];
  return (result) => {
    const p = result?.properties || {};
    const haystack = JSON.stringify([
      p.industry,
      (result?.tags || []).filter((t: any) => String(t?.type).startsWith('urn:tag:genre')).map((t: any) => t.name),
    ]).toLocaleLowerCase();
    return terms.some((t) => haystack.includes(t));
  };
}

// How the brand side of a match was built:
//   brand        the brand itself is in Qloo
//   reference    it isn't; the user's reference brands stand in for its audience
//   description  it isn't; Qloo entities named in the brand's own description or web page do
//   style        it isn't, and its description names too little that Qloo knows: the
//                brand's own style words, as Qloo taste tags, stand in for its audience
export type BrandBasis = 'brand' | 'reference' | 'description' | 'style';

// A style-only brand side needs at least this many exact Qloo taste tags.
const MIN_STYLE_TAGS = 2;
const MAX_STYLE_TAGS = 5;

// A description must name at least this many Qloo entities; generic copy ("premium,
// sustainable, for everyone") names none and is not evidence.
export const MIN_DESCRIPTION_ENTITIES = 3;
const MAX_DESCRIPTION = 2000;

const noPeriod = (s: string) => s.replace(/\.$/, '');

// The description as given, or the visible text of the brand's web page.
type DescriptionError = { error: string; kind: NoDataReason };

// The same page is read for names and then for style keywords; read it once.
const pageCache = new Map<string, { at: number; text: string }>();
const PAGE_CACHE_MS = 10 * 60 * 1000;

async function descriptionText(description: string, trace?: Trace): Promise<{ text: string } | DescriptionError> {
  let text = description;
  if (/^https?:\/\//i.test(description)) {
    const hit = bypassCache() ? undefined : pageCache.get(description);
    if (hit && Date.now() - hit.at < PAGE_CACHE_MS) return { text: hit.text };
    const t0 = Date.now();
    try {
      const page = await fetchPageText(description);
      text = page.text;
      pageCache.set(description, { at: Date.now(), text });
      trace?.add({
        stage: 'brand',
        tool: 'Brand web page',
        input: description,
        output: `${text.length} characters from ${page.url}${page.note ? ` (page text plus the ${page.note})` : ''}`,
        decision:
          text.length < 300 && !page.note
            ? 'Very little text: the page probably loads its content in the browser; a pasted description would work better'
            : undefined,
        ms: Date.now() - t0,
      });
    } catch (e: any) {
      trace?.add({ stage: 'brand', tool: 'Brand web page', input: description, output: `Failed: ${e.message}`, ms: Date.now() - t0, ok: false });
      return { error: `Couldn’t read that page (${noPeriod(e.message)})`, kind: 'description-unreadable' };
    }
  }
  if (text.trim().length < 20) return { error: 'The description is too short to name anything', kind: 'description-unreadable' };
  return { text };
}

// When Groq answered because Gemini failed, the trace shows the Gemini failure first. A
// cached answer made no call this time, so it records none.
function traceFallback(trace: Trace | undefined, input: string, answer: LlmAnswer<unknown>, cached: boolean) {
  if (!answer.geminiFailure || cached) return;
  trace?.add({
    stage: 'brand',
    tool: `Gemini (${GEMINI_MODEL})`,
    input,
    output: `Failed: ${answer.geminiFailure}`,
    decision: 'Ask Groq once, with the same prompt and schema',
    ok: false,
  });
}

// Tag signal, only to supplement fewer than MIN_DESCRIPTION_ENTITIES entities: the LLM
// proposes style keywords from the description, and only keywords that are exactly the
// name of a Qloo tag are used, by tag id. Never free text.
async function describedTags(description: string, trace?: Trace, max = 3): Promise<{ tags: QlooTag[]; error?: string }> {
  const page = await descriptionText(description, trace);
  if ('error' in page) return { tags: [], error: page.error };
  const g0 = Date.now();
  const input = 'The brand’s description: style and culture keywords it states';
  let keywords: string[];
  try {
    const key = `brand-keywords:${createHash('sha256').update(page.text).digest('hex')}`;
    const r = await cachedAnswer(key, () => extractBrandKeywords(page.text));
    keywords = r.value.value;
    traceFallback(trace, input, r.value, r.cached);
    trace?.add({
      stage: 'brand',
      tool: llmLabel(r.value),
      input,
      output: (keywords.length ? `Proposed ${keywords.join(', ')}` : 'Proposed none') + cachedNote(r.cached, r.at),
      decision: 'Keywords are looked up as Qloo tags; only exact tag names are used',
      cached: r.cached,
      ms: Date.now() - g0,
    });
  } catch (e: any) {
    const error = llmFailure(e);
    trace?.add({ stage: 'brand', tool: `Gemini (${GEMINI_MODEL})`, input, output: `Failed: ${error}`, decision: 'No tag signal', ms: Date.now() - g0, ok: false });
    return { tags: [], error: `Couldn’t extract keywords (${error})` };
  }
  const tags = await Promise.all(keywords.map((k) => findTag(k, trace && { trace, stage: 'brand' }, 'urn:entity:brand').catch(() => null)));
  return { tags: [...new Map(tags.filter((t): t is QlooTag => Boolean(t)).map((t) => [t.id, t])).values()].slice(0, max) };
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BASE64 = 4_000_000; // about 3 MB of image

function parseImage(raw: unknown): InlineImage | null {
  const img = raw as any;
  if (!img) return null;
  const data = String(img.data || '');
  const mimeType = String(img.mimeType || '');
  if (!IMAGE_TYPES.includes(mimeType) || !data || !/^[A-Za-z0-9+/=]+$/.test(data)) {
    throw new ApiError('The key visual must be a JPEG, PNG or WebP image.', 400);
  }
  if (data.length > MAX_IMAGE_BASE64) throw new ApiError('The key visual is too large; use an image under 3 MB.', 400);
  return { data, mimeType };
}

// Key visual → style keywords → exact-name Qloo taste tags. Only ever a supplement.
async function imageTags(image: InlineImage, trace?: Trace): Promise<QlooTag[]> {
  const g0 = Date.now();
  const input = 'The brand’s key visual: visible style keywords';
  let keywords: string[];
  try {
    const key = `brand-image:${createHash('sha256').update(image.data).digest('hex')}`;
    const r = await cachedAnswer(key, () => extractImageKeywords(image));
    keywords = r.value.value;
    trace?.add({
      stage: 'brand',
      tool: llmLabel(r.value),
      input,
      output: (keywords.length ? `Proposed ${keywords.join(', ')}` : 'Proposed none') + cachedNote(r.cached, r.at),
      decision: 'Keywords are looked up as Qloo tags; only exact tag names are used',
      cached: r.cached,
      ms: Date.now() - g0,
    });
  } catch (e: any) {
    trace?.add({ stage: 'brand', tool: `Gemini (${GEMINI_MODEL})`, input, output: `Failed: ${llmFailure(e)}`, decision: 'No image signal', ms: Date.now() - g0, ok: false });
    return [];
  }
  const tags = await Promise.all(keywords.map((k) => findTag(k, trace && { trace, stage: 'brand' }, 'urn:entity:brand').catch(() => null)));
  return [...new Map(tags.filter((t): t is QlooTag => Boolean(t)).map((t) => [t.id, t])).values()].slice(0, 3);
}

// The brand's description, or the text of its web page → the LLM proposes the names it
// explicitly mentions (same rules as for videos) → only exact Qloo matches are kept.
async function describedEntities(description: string, trace?: Trace): Promise<{ entities: QlooEntity[] } | DescriptionError> {
  const page = await descriptionText(description, trace);
  if ('error' in page) return page;
  const text = page.text;

  const g0 = Date.now();
  const input = 'The brand’s description: list names explicitly mentioned';
  let mentions: { name: string; kind: string }[];
  try {
    const key = `brand-desc:${createHash('sha256').update(text).digest('hex')}`;
    const r = await cachedAnswer(key, () => extractBrandMentions(text));
    mentions = r.value.value;
    traceFallback(trace, input, r.value, r.cached);
    trace?.add({
      stage: 'brand',
      tool: llmLabel(r.value),
      input,
      output:
        (mentions.length ? `Proposed ${mentions.length}: ${mentions.map((m) => `${m.name} (${m.kind})`).join(', ')}` : 'Proposed none') +
        cachedNote(r.cached, r.at),
      decision: 'Names go to Qloo as search terms, not as evidence',
      cached: r.cached,
      ms: Date.now() - g0,
    });
  } catch (e: any) {
    const error = llmFailure(e);
    trace?.add({ stage: 'brand', tool: `Gemini (${GEMINI_MODEL})`, input, output: `Failed: ${error}`, ms: Date.now() - g0, ok: false });
    return { error: `Couldn’t extract names from the description (${error})`, kind: 'llm-unavailable' };
  }

  const resolved = await Promise.all(
    mentions.map((m) => resolveEntity(m.name, KIND_TYPES[m.kind], undefined, trace && { trace, stage: 'brand' }).catch(() => null))
  );
  return { entities: [...new Map(resolved.filter((e): e is QlooEntity => Boolean(e)).map((e) => [e.id, e])).values()] };
}

type FoundBrand = Extract<BrandLookup, { found: true }>;

// Why the brand side only approximates the brand's audience, or null when it is the brand
// itself: reference brands, entities from a description, or tags from a key visual.
export function approximation(b: Pick<FoundBrand, 'basis' | 'signal' | 'imageTags'> & { tags?: QlooTag[] }): string | null {
  const names = b.signal.map((e) => e.name).join(', ');
  const parts: string[] = [];
  if (b.basis === 'reference') parts.push(`reference brands stand in for the brand (${names})`);
  if (b.basis === 'description') parts.push(`entities named in its description stand in for it (${names})`);
  if (b.basis === 'style') parts.push(`its style words, as Qloo taste tags, stand in for it${names ? `, with ${names}` : ''}`);
  if (b.imageTags.length) parts.push(`tags inferred from the key visual are included (${b.imageTags.map((t) => t.name).join(', ')})`);
  return parts.length ? parts.join('; ') : null;
}

// One level less sure whenever the brand side is approximated. Used by both modes, so a
// reference brand or a key visual costs the same confidence everywhere.
export function brandConfidence(
  c: Compatibility,
  brand: Pick<FoundBrand, 'basis' | 'signal' | 'imageTags'>,
  trace?: Trace,
  label = ''
): Compatibility {
  const why = approximation(brand);
  if (!why || !c.confidence) return c;
  const before: ConfidenceLevel = c.confidence;
  const after = lowerConfidence(before);
  trace?.add({
    stage: 'score',
    tool: 'Rule',
    input: `${label}The brand side is approximated: ${why}`,
    output: before === 'Low' ? 'Confidence Low (already the lowest level)' : `Confidence ${before} → ${after}`,
    decision:
      before === 'Low'
        ? 'Stays Low: these approximate the brand’s audience, they aren’t it'
        : 'Lower confidence one level: these approximate the brand’s audience, they aren’t it',
  });
  return { ...c, confidence: after };
}

// Qloo brands whose name starts with the input: Qloo names often carry a suffix the user
// doesn't type ("Le Labo" is "Le Labo Fragrances", with no aliases).
async function suggestionsFor(name: string, trace?: Trace): Promise<string[]> {
  const q = compact(name);
  if (q.length < 3) return [];
  const found = await searchEntities(name, ['urn:entity:brand'], 5, trace && { trace, stage: 'brand' }, 'names starting with it').catch(() => []);
  return found
    .map((r) => String(r.name || ''))
    .filter((n) => n && compact(n).startsWith(q))
    .slice(0, 3);
}

export interface MissingReference {
  name: string;
  suggestions: string[];
}

export type BrandLookup =
  | {
      found: false;
      brand: { name: string; category: string | null };
      entities: [];
      suggestions: string[];
      missingReferences: MissingReference[]; // reference brands Qloo doesn't have
      reason: NoDataReason;
      error: string;
    }
  | {
      found: true;
      brand: { name: string; category: string | null; entity: QlooEntity | null };
      basis: BrandBasis;
      signal: QlooEntity[]; // brand-side signal sent to Qloo: the brand, or the reference brands
      tags: QlooTag[]; // every tag in the signal, from the description and the key visual
      imageTags: QlooTag[]; // the ones from the key visual
      entities: QlooEntity[]; // cultural proxies of that signal
      warnings: string[];
    };

export interface BrandFallback {
  referenceBrands?: unknown; // 1–3 brand names in Qloo with a similar audience
  description?: unknown; // a short description of the brand, or its https:// web page
  image?: unknown; // { data: base64, mimeType }: the brand's key visual, a weak supplement
  proxies?: boolean; // false: skip the brand's cultural proxies (Find creators doesn't use them)
}

// Trimmed, non-empty, without duplicates ("Le Labo" = "lelabo").
function cleanList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const seen = new Set<string>();
  return list.filter((x) => !seen.has(compact(x)) && seen.add(compact(x)));
}

// Throws ApiError for bad input and Qloo failures; "not found" is a normal result.
export async function lookupBrand(
  rawName: unknown,
  rawCategory: unknown,
  trace?: Trace,
  fallback: BrandFallback = {}
): Promise<BrandLookup> {
  const name = String(rawName || '').trim();
  const category = String(rawCategory || '').trim();
  if (!name) throw new ApiError('Provide a brand name.', 400);
  const references = cleanList(fallback.referenceBrands);
  if (references.length > MAX_REFERENCE_BRANDS) throw new ApiError(`Name at most ${MAX_REFERENCE_BRANDS} reference brands.`, 400);
  const description = String(fallback.description || '').trim();
  if (description.length > MAX_DESCRIPTION) throw new ApiError(`Keep the description under ${MAX_DESCRIPTION} characters.`, 400);
  const image = parseImage(fallback.image);

  const resolveBrand = async (q: string, prefer?: (r: any) => boolean) => {
    try {
      return await resolveEntity(q, ['urn:entity:brand'], prefer, trace && { trace, stage: 'brand' });
    } catch (e: any) {
      throw new ApiError(`Qloo lookup failed: ${e.message}`, 502);
    }
  };
  const notFound = (
    reason: NoDataReason,
    error: string,
    suggestions: string[] = [],
    missingReferences: MissingReference[] = []
  ): BrandLookup => ({
    found: false,
    brand: { name, category: category || null },
    entities: [],
    suggestions,
    missingReferences,
    reason,
    error,
  });

  const entity = await resolveBrand(name, categoryMatcher(category));
  let basis: BrandBasis = 'brand';
  let signal: QlooEntity[];
  let styleTags: QlooTag[] = [];

  if (entity) {
    signal = [entity];
  } else if (!references.length && description) {
    // No reference brands: build the brand side from its own description instead.
    const found = await describedEntities(description, trace);
    const verified = 'entities' in found ? found.entities : [];
    const enough = verified.length >= MIN_DESCRIPTION_ENTITIES;
    trace?.add({
      stage: 'brand',
      tool: 'Rule',
      input: `“${name}” is not in Qloo; evidence threshold for its description: at least ${MIN_DESCRIPTION_ENTITIES} Qloo-confirmed entities`,
      output: 'error' in found ? found.error : `${verified.length} confirmed: ${verified.map((e) => e.name).join(', ') || 'none'}`,
      decision: enough
        ? 'Use them together as the brand-side signal'
        : 'error' in found
          ? 'Stop: ask for reference brands instead'
          : `Too few named entities; try the brand’s style words as Qloo taste tags (at least ${MIN_STYLE_TAGS})`,
    });
    let style: QlooTag[] = [];
    if (!enough && !('error' in found)) {
      const s = await describedTags(description, trace, MAX_STYLE_TAGS);
      style = s.tags;
      trace?.add({
        stage: 'brand',
        tool: 'Rule',
        input: `The brand’s style as Qloo taste tags: at least ${MIN_STYLE_TAGS} needed`,
        output: style.length ? `${style.length}: ${style.map((t) => `${t.name} (${t.id})`).join(', ')}` : s.error || 'No style word is exactly a Qloo taste tag',
        decision:
          style.length >= MIN_STYLE_TAGS
            ? `Use them${verified.length ? `, with ${verified.map((e) => e.name).join(', ')},` : ''} as the brand-side signal`
            : 'Stop: ask for reference brands instead',
      });
    }
    if (!enough && style.length >= MIN_STYLE_TAGS) {
      basis = 'style';
      signal = verified;
      styleTags = style;
    } else if (!enough) {
      return notFound(
        'error' in found ? found.kind : 'description-too-few-names',
        'error' in found
          ? `${found.error}. Enter 1–${MAX_REFERENCE_BRANDS} reference brands with a similar audience that are in Qloo instead.`
          : `Your description names ${verified.length} thing${verified.length === 1 ? '' : 's'} Qloo knows (at least ${MIN_DESCRIPTION_ENTITIES} are needed), and fewer than ${MIN_STYLE_TAGS} of its style words are Qloo taste tags. Enter 1–${MAX_REFERENCE_BRANDS} reference brands with a similar audience that are in Qloo instead.`
      );
    } else {
      basis = 'description';
      signal = verified;
    }
  } else if (!references.length) {
    // Never fall back to a similar-looking brand (PRODUCT_SPEC §3.2): offer names that
    // start with the input, or reference brands, for the user to choose.
    const suggestions = await suggestionsFor(name, trace);
    trace?.add({
      stage: 'brand',
      tool: 'Rule',
      input: `Brand “${name}”`,
      output: `No Qloo brand with this exact name or alias${suggestions.length ? `; names starting with it: ${suggestions.join(', ')}` : ''}`,
      decision: suggestions.length
        ? 'Stop: ask the user to pick one or name reference brands, rather than substituting one'
        : 'Stop: ask the user for reference brands; no similar-looking brand is substituted',
    });
    return notFound(
      suggestions.length ? 'brand-name-mismatch' : 'brand-not-in-qloo',
      suggestions.length
        ? `Qloo has no brand named exactly “${name}”. Did you mean ${suggestions.map((s) => `“${s}”`).join(' or ')}?`
        : `Your brand isn’t in Qloo. Describe it (or paste its web page), or enter 1–${MAX_REFERENCE_BRANDS} reference brands with a similar audience that are in Qloo.`,
      suggestions
    );
  } else {
    // Reference brands, each verified by exact name or alias like any other evidence.
    const resolved = await Promise.all(references.map((r) => resolveBrand(r)));
    const missing = references.filter((_, i) => !resolved[i]);
    const verified = [...new Map(resolved.filter((e): e is QlooEntity => Boolean(e)).map((e) => [e.id, e])).values()];
    trace?.add({
      stage: 'brand',
      tool: 'Rule',
      input: `“${name}” is not in Qloo; reference brand${references.length === 1 ? '' : 's'}: ${references.join(', ')}`,
      output:
        `${verified.length} verified in Qloo${verified.length ? `: ${verified.map((e) => e.name).join(', ')}` : ''}` +
        (missing.length ? `; not found: ${missing.join(', ')}` : ''),
      decision: missing.length
        ? 'Stop: ask the user to replace the ones Qloo doesn’t have, rather than silently scoring with fewer'
        : 'Use the reference brands together as the brand-side signal',
    });
    if (missing.length) {
      const missingReferences = await Promise.all(missing.map(async (m) => ({ name: m, suggestions: await suggestionsFor(m, trace) })));
      return notFound(
        'reference-not-in-qloo',
        `Qloo has no brand named exactly ${missing.map((m) => `“${m}”`).join(', ')}. Replace ${missing.length === 1 ? 'it' : 'them'} with a reference brand Qloo has.`,
        [],
        missingReferences
      );
    }
    basis = 'reference';
    signal = verified;
  }

  // The brand-side entities, re-checked against Qloo's own record (GET /entities) like the
  // creator's. One that no longer matches its name stops the run instead of being dropped
  // silently: the user named it, so the user decides what replaces it.
  const { kept, dropped } = await verifyEntities(signal, trace && { trace, stage: 'brand' });
  if (dropped.length) {
    return notFound(
      'brand-name-mismatch',
      `Qloo’s record for ${dropped.map((e) => `“${e.name}”`).join(', ')} doesn’t match ${dropped.map((e) => `“${e.query}”`).join(', ')} by name or alias, so it isn’t used.`
    );
  }
  signal = kept;

  // Tags only supplement a thin brand side (fewer than MIN_DESCRIPTION_ENTITIES reference
  // brands) and only when the user also described the brand. Never for the brand itself.
  let tags: QlooTag[] = styleTags;
  if (basis === 'reference' && signal.length < MIN_DESCRIPTION_ENTITIES && description) {
    const found = await describedTags(description, trace);
    tags = found.tags;
    trace?.add({
      stage: 'brand',
      tool: 'Rule',
      input: `${signal.length} reference brand${signal.length === 1 ? '' : 's'}, below ${MIN_DESCRIPTION_ENTITIES}; the user also described the brand`,
      output: tags.length
        ? `${tags.length} Qloo tag${tags.length === 1 ? '' : 's'}: ${tags.map((t) => `${t.name} (${t.id})`).join(', ')}`
        : found.error || 'No keyword is exactly the name of a Qloo taste tag',
      decision: tags.length ? 'Add them to the brand-side signal (signal.interests.tags)' : 'Continue with the reference brands alone',
    });
  }

  // The key visual adds tags on any brand side, but never builds one on its own.
  let fromImage: QlooTag[] = [];
  if (image) {
    fromImage = (await imageTags(image, trace)).filter((t) => !tags.some((x) => x.id === t.id));
    trace?.add({
      stage: 'brand',
      tool: 'Rule',
      input: 'Key visual as a supplementary signal',
      output: fromImage.length ? `${fromImage.length} Qloo tag${fromImage.length === 1 ? '' : 's'}: ${fromImage.map((t) => `${t.name} (${t.id})`).join(', ')}` : 'No exact Qloo tags',
      decision: fromImage.length ? 'Add them to the brand-side signal; confidence drops one level' : 'Continue without an image signal',
    });
    tags = [...tags, ...fromImage];
  }

  const warnings: string[] = [];
  const batches = await Promise.all(
    (fallback.proxies === false ? [] : PROXY_TYPES).map(async (type) => {
      try {
        return await getInsights(signal, type, PROXIES_PER_TYPE, trace && { trace, stage: 'brand' }, tags, expansionParams(signal.map((e) => e.id)));
      } catch (e: any) {
        warnings.push(`Cultural proxy lookup failed for ${type.replace('urn:entity:', '')}: ${e.message}`);
        return [] as QlooEntity[];
      }
    })
  );
  if (batches.length && warnings.length === batches.length) throw new ApiError('Every Qloo insights request failed.', 502, { warnings });

  const seen = new Set(signal.map((e) => e.id));
  const entities = batches.flat().filter((e) => !seen.has(e.id) && seen.add(e.id));

  const checked = entity ? (signal.find((e) => e.id === entity.id) ?? entity) : null; // with /entities popularity
  return { found: true, brand: { name, category: category || null, entity: checked }, basis, signal, tags, imageTags: fromImage, entities, warnings };
}
