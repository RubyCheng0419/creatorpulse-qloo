import { createHash } from 'node:crypto';
import { KIND_TYPES, cachedGemini, cachedNote, extractBrandKeywords, extractBrandMentions, geminiError } from '@/lib/creator';
import { ApiError } from '@/lib/errors';
import { GEMINI_MODEL } from '@/lib/gemini';
import { fetchPageText } from '@/lib/web-page';
import { PROXY_TYPES, QlooEntity, QlooTag, compact, findTag, getInsights, resolveEntity, searchEntities } from '@/lib/qloo';
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
export type BrandBasis = 'brand' | 'reference' | 'description';

// A description must name at least this many Qloo entities; generic copy ("premium,
// sustainable, for everyone") names none and is not evidence.
export const MIN_DESCRIPTION_ENTITIES = 3;
const MAX_DESCRIPTION = 2000;

const noPeriod = (s: string) => s.replace(/\.$/, '');

// The description as given, or the visible text of the brand's web page.
async function descriptionText(description: string, trace?: Trace): Promise<{ text: string } | { error: string }> {
  let text = description;
  if (/^https?:\/\//i.test(description)) {
    const t0 = Date.now();
    try {
      const page = await fetchPageText(description);
      text = page.text;
      trace?.add({
        stage: 'brand',
        tool: 'Brand web page',
        input: description,
        output: `${text.length} characters of visible text from ${page.url}`,
        ms: Date.now() - t0,
      });
    } catch (e: any) {
      trace?.add({ stage: 'brand', tool: 'Brand web page', input: description, output: `Failed: ${e.message}`, ms: Date.now() - t0, ok: false });
      return { error: `Couldn’t read that page (${noPeriod(e.message)})` };
    }
  }
  if (text.trim().length < 20) return { error: 'The description is too short to name anything' };
  return { text };
}

// Tag signal, only to supplement fewer than MIN_DESCRIPTION_ENTITIES entities: Gemini
// proposes style keywords from the description, and only keywords that are exactly the
// name of a Qloo tag are used, by tag id. Never free text.
async function describedTags(description: string, trace?: Trace): Promise<{ tags: QlooTag[]; error?: string }> {
  const page = await descriptionText(description, trace);
  if ('error' in page) return { tags: [], error: page.error };
  const g0 = Date.now();
  const tool = `Gemini (${GEMINI_MODEL})`;
  let keywords: string[];
  try {
    const key = `brand-keywords:${createHash('sha256').update(page.text).digest('hex')}`;
    const r = await cachedGemini(key, () => extractBrandKeywords(page.text));
    keywords = r.value;
    trace?.add({
      stage: 'brand',
      tool,
      input: 'The brand’s description: style and culture keywords it states',
      output: (keywords.length ? `Proposed ${keywords.join(', ')}` : 'Proposed none') + cachedNote(r.cached, r.at),
      decision: 'Keywords are looked up as Qloo tags; only exact tag names are used',
      cached: r.cached,
      ms: Date.now() - g0,
    });
  } catch (e: any) {
    const error = geminiError(e);
    trace?.add({ stage: 'brand', tool, input: 'The brand’s description: keywords', output: `Failed: ${error}`, decision: 'No tag signal', ms: Date.now() - g0, ok: false });
    return { tags: [], error: `Couldn’t extract keywords (${error})` };
  }
  const tags = await Promise.all(keywords.map((k) => findTag(k, trace && { trace, stage: 'brand' }).catch(() => null)));
  return { tags: [...new Map(tags.filter((t): t is QlooTag => Boolean(t)).map((t) => [t.id, t])).values()].slice(0, 3) };
}

// The brand's description, or the text of its web page → Gemini proposes the names it
// explicitly mentions (same rules as for videos) → only exact Qloo matches are kept.
async function describedEntities(description: string, trace?: Trace): Promise<{ entities: QlooEntity[] } | { error: string }> {
  const page = await descriptionText(description, trace);
  if ('error' in page) return page;
  const text = page.text;

  const g0 = Date.now();
  const tool = `Gemini (${GEMINI_MODEL})`;
  let mentions: { name: string; kind: string }[];
  try {
    const key = `brand-desc:${createHash('sha256').update(text).digest('hex')}`;
    const r = await cachedGemini(key, () => extractBrandMentions(text));
    mentions = r.value;
    trace?.add({
      stage: 'brand',
      tool,
      input: 'The brand’s description: list names explicitly mentioned',
      output:
        (mentions.length ? `Proposed ${mentions.length}: ${mentions.map((m) => `${m.name} (${m.kind})`).join(', ')}` : 'Proposed none') +
        cachedNote(r.cached, r.at),
      decision: 'Names go to Qloo as search terms, not as evidence',
      cached: r.cached,
      ms: Date.now() - g0,
    });
  } catch (e: any) {
    const error = geminiError(e);
    trace?.add({ stage: 'brand', tool, input: 'The brand’s description', output: `Failed: ${error}`, ms: Date.now() - g0, ok: false });
    return { error: `Couldn’t extract names from the description (${error})` };
  }

  const resolved = await Promise.all(
    mentions.map((m) => resolveEntity(m.name, KIND_TYPES[m.kind], undefined, trace && { trace, stage: 'brand' }).catch(() => null))
  );
  return { entities: [...new Map(resolved.filter((e): e is QlooEntity => Boolean(e)).map((e) => [e.id, e])).values()] };
}

// Qloo brands whose name starts with the input: Qloo names often carry a suffix the user
// doesn't type ("Le Labo" is "Le Labo Fragrances", with no aliases).
async function suggestionsFor(name: string): Promise<string[]> {
  const q = compact(name);
  if (q.length < 3) return [];
  return (await searchEntities(name, ['urn:entity:brand']))
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
      error: string;
    }
  | {
      found: true;
      brand: { name: string; category: string | null; entity: QlooEntity | null };
      basis: BrandBasis;
      signal: QlooEntity[]; // brand-side signal sent to Qloo: the brand, or the reference brands
      tags: QlooTag[];
      entities: QlooEntity[]; // cultural proxies of that signal
      warnings: string[];
    };

export interface BrandFallback {
  referenceBrands?: unknown; // 1–3 brand names in Qloo with a similar audience
  description?: unknown; // a short description of the brand, or its https:// web page
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

  const resolveBrand = async (q: string, prefer?: (r: any) => boolean) => {
    try {
      return await resolveEntity(q, ['urn:entity:brand'], prefer, trace && { trace, stage: 'brand' });
    } catch (e: any) {
      throw new ApiError(`Qloo lookup failed: ${e.message}`, 502);
    }
  };
  const notFound = (error: string, suggestions: string[] = [], missingReferences: MissingReference[] = []): BrandLookup => ({
    found: false,
    brand: { name, category: category || null },
    entities: [],
    suggestions,
    missingReferences,
    error,
  });

  const entity = await resolveBrand(name, categoryMatcher(category));
  let basis: BrandBasis = 'brand';
  let signal: QlooEntity[];

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
        : 'Stop: not enough evidence in the description; ask for reference brands instead',
    });
    if (!enough) {
      return notFound(
        'error' in found
          ? `${found.error}. Enter 1–${MAX_REFERENCE_BRANDS} reference brands with a similar audience that are in Qloo instead.`
          : `Only ${verified.length} name${verified.length === 1 ? '' : 's'} in your description matched Qloo exactly${verified.length ? ` (${verified.map((e) => e.name).join(', ')})` : ''}; at least ${MIN_DESCRIPTION_ENTITIES} are needed. Enter 1–${MAX_REFERENCE_BRANDS} reference brands with a similar audience that are in Qloo instead.`
      );
    }
    basis = 'description';
    signal = verified;
  } else if (!references.length) {
    // Never fall back to a similar-looking brand (PRODUCT_SPEC §3.2): offer names that
    // start with the input, or reference brands, for the user to choose.
    const suggestions = await suggestionsFor(name);
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
      suggestions.length
        ? `Qloo has no brand named exactly “${name}”. Did you mean ${suggestions.map((s) => `“${s}”`).join(' or ')}?`
        : `Your brand isn’t in Qloo. Enter 1–${MAX_REFERENCE_BRANDS} reference brands with a similar audience that are in Qloo.`,
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
      const missingReferences = await Promise.all(missing.map(async (m) => ({ name: m, suggestions: await suggestionsFor(m) })));
      return notFound(
        `Qloo has no brand named exactly ${missing.map((m) => `“${m}”`).join(', ')}. Replace ${missing.length === 1 ? 'it' : 'them'} with a reference brand Qloo has.`,
        [],
        missingReferences
      );
    }
    basis = 'reference';
    signal = verified;
  }

  // Tags only supplement a thin brand side (fewer than MIN_DESCRIPTION_ENTITIES reference
  // brands) and only when the user also described the brand. Never for the brand itself.
  let tags: QlooTag[] = [];
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

  const warnings: string[] = [];
  const batches = await Promise.all(
    PROXY_TYPES.map(async (type) => {
      try {
        return await getInsights(signal, type, PROXIES_PER_TYPE, trace && { trace, stage: 'brand' }, tags);
      } catch (e: any) {
        warnings.push(`Cultural proxy lookup failed for ${type.replace('urn:entity:', '')}: ${e.message}`);
        return [] as QlooEntity[];
      }
    })
  );
  if (warnings.length === PROXY_TYPES.length) throw new ApiError('Every Qloo insights request failed.', 502, { warnings });

  const seen = new Set(signal.map((e) => e.id));
  const entities = batches.flat().filter((e) => !seen.has(e.id) && seen.add(e.id));

  return { found: true, brand: { name, category: category || null, entity }, basis, signal, tags, entities, warnings };
}
