import { ApiError } from '@/lib/errors';
import { PROXY_TYPES, QlooEntity, QlooTag, compact, getInsights, resolveEntity, searchEntities } from '@/lib/qloo';
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
//   brand      the brand itself is in Qloo
//   reference  it isn't; the user's reference brands stand in for its audience
export type BrandBasis = 'brand' | 'reference';

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

  const warnings: string[] = [];
  const batches = await Promise.all(
    PROXY_TYPES.map(async (type) => {
      try {
        return await getInsights(signal, type, PROXIES_PER_TYPE, trace && { trace, stage: 'brand' });
      } catch (e: any) {
        warnings.push(`Cultural proxy lookup failed for ${type.replace('urn:entity:', '')}: ${e.message}`);
        return [] as QlooEntity[];
      }
    })
  );
  if (warnings.length === PROXY_TYPES.length) throw new ApiError('Every Qloo insights request failed.', 502, { warnings });

  const seen = new Set(signal.map((e) => e.id));
  const entities = batches.flat().filter((e) => !seen.has(e.id) && seen.add(e.id));

  return { found: true, brand: { name, category: category || null, entity }, basis, signal, tags: [], entities, warnings };
}
