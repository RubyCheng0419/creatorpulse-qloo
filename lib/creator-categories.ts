// Creator types for "Find creators", as Qloo tags on person entities. Pure data, shared by
// the server and the browser. Each tag was checked on 2026-10-27 to return YouTubers as a
// /v2/insights filter.tags; the categories come from Wikipedia, so coverage is uneven
// (e.g. a few lifestyle creators are filed under fashion).

export const YOUTUBER_TAG = 'urn:tag:genre:person:youtuber';

export const CREATOR_CATEGORIES = {
  any: { label: 'Any YouTuber', tag: YOUTUBER_TAG },
  technology: { label: 'Technology', tag: 'urn:tag:wikipedia_category:wikidata:technology_youtubers' },
  gaming: { label: 'Gaming', tag: 'urn:tag:wikipedia_category:wikidata:gaming_youtubers' },
  beauty: { label: 'Beauty & makeup', tag: 'urn:tag:wikipedia_category:wikidata:beauty_makeup_youtubers' },
  fashion: { label: 'Fashion', tag: 'urn:tag:wikipedia_category:wikidata:fashion_youtubers' },
  lifestyle: { label: 'Lifestyle', tag: 'urn:tag:wikipedia_category:wikidata:lifestyle_youtubers' },
  comedy: { label: 'Comedy', tag: 'urn:tag:wikipedia_category:wikidata:comedy_youtubers' },
  music: { label: 'Music', tag: 'urn:tag:wikipedia_category:wikidata:music_youtubers' },
} as const;

export type CreatorCategory = keyof typeof CREATOR_CATEGORIES;

export function isCreatorCategory(v: unknown): v is CreatorCategory {
  return typeof v === 'string' && v in CREATOR_CATEGORIES;
}
