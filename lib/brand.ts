import { ApiError } from '@/lib/errors';
import { PROXY_TYPES, QlooEntity, compact, getInsights, resolveEntity, searchEntities } from '@/lib/qloo';
import type { Trace } from '@/lib/trace';

// PRODUCT_SPEC v3.1 §4.1 step 3: brand name → Qloo brand entity → its cultural proxies
// (cross-domain entities Qloo associates with the brand, each with affinity). Server-only.

const PROXIES_PER_TYPE = 5;

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

export type BrandLookup =
  | { found: false; brand: { name: string; category: string | null }; entities: []; suggestions: string[]; error: string }
  | {
      found: true;
      brand: { name: string; category: string | null; entity: QlooEntity };
      entities: QlooEntity[];
      warnings: string[];
    };

// Throws ApiError for bad input and Qloo failures; "not found" is a normal result.
export async function lookupBrand(rawName: unknown, rawCategory: unknown, trace?: Trace): Promise<BrandLookup> {
  const name = String(rawName || '').trim();
  const category = String(rawCategory || '').trim();
  if (!name) throw new ApiError('Provide a brand name.', 400);

  let entity: QlooEntity | null;
  try {
    entity = await resolveEntity(name, ['urn:entity:brand'], categoryMatcher(category), trace && { trace, stage: 'brand' });
  } catch (e: any) {
    throw new ApiError(`Qloo lookup failed: ${e.message}`, 502);
  }

  // Never fall back to a similar-looking brand (PRODUCT_SPEC §3.2). Qloo names often carry
  // a suffix the user doesn't type ("Le Labo" is "Le Labo Fragrances", with no aliases),
  // so brands whose name starts with the input are offered for the user to pick.
  if (!entity) {
    const q = compact(name);
    const suggestions =
      q.length < 3
        ? []
        : (await searchEntities(name, ['urn:entity:brand']))
            .map((r) => String(r.name || ''))
            .filter((n) => n && compact(n).startsWith(q))
            .slice(0, 3);
    trace?.add({
      stage: 'brand',
      tool: 'Rule',
      input: `Brand “${name}”`,
      output: `No Qloo brand with this exact name or alias${suggestions.length ? `; names starting with it: ${suggestions.join(', ')}` : ''}`,
      decision: suggestions.length
        ? 'Stop: ask the user to pick one, rather than substituting it'
        : 'Stop: no similar-looking brand is substituted',
    });
    return {
      found: false,
      brand: { name, category: category || null },
      entities: [],
      suggestions,
      error: suggestions.length
        ? `Qloo has no brand named exactly “${name}”. Did you mean ${suggestions.map((s) => `“${s}”`).join(' or ')}?`
        : 'Qloo has no brand by this name. Try its full English name, or run the demo pair.',
    };
  }

  const warnings: string[] = [];
  const batches = await Promise.all(
    PROXY_TYPES.map(async (type) => {
      try {
        return await getInsights([entity], type, PROXIES_PER_TYPE, trace && { trace, stage: 'brand' });
      } catch (e: any) {
        warnings.push(`Cultural proxy lookup failed for ${type.replace('urn:entity:', '')}: ${e.message}`);
        return [] as QlooEntity[];
      }
    })
  );
  if (warnings.length === PROXY_TYPES.length) throw new ApiError('Every Qloo insights request failed.', 502, { warnings });

  const seen = new Set([entity.id]);
  const entities = batches.flat().filter((e) => !seen.has(e.id) && seen.add(e.id));

  return { found: true, brand: { name, category: category || null, entity }, entities, warnings };
}
