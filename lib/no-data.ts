// Why a match got no score, as a fixed category, so test runs can count causes instead of
// guessing. Pure data, shared by the server and the browser.

export type NoDataReason =
  | 'brand-name-mismatch' // no exact brand match, but Qloo has brands starting with the input
  | 'brand-not-in-qloo' // nothing close: the user can name reference brands or describe the brand
  | 'reference-not-in-qloo' // a reference brand isn't in Qloo
  | 'description-unreadable' // the brand page couldn't be read, or the text is too short
  | 'description-too-few-names' // the description names fewer than 3 Qloo entities
  | 'llm-unavailable' // no LLM could propose names (Gemini and Groq both failed)
  | 'too-few-creator-entities' // the videos name fewer than 3 Qloo entities
  | 'no-affinity' // Qloo scored none of the creator's entities against the brand
  | 'too-few-dimensions' // fewer than 2 taste dimensions rest on 3+ scored entities
  | 'no-candidates' // Find creators: Qloo returned no creators for this brand and type
  | 'too-few-profile-entities'; // Find creators: too little of a creator's audience taste was scored

// For each cause: what the user can do next, the single most useful step first. Shown under
// the "insufficient data" message as "Next step" and "Other options".
export const NO_DATA_NEXT_STEPS: Record<NoDataReason, string[]> = {
  'brand-name-mismatch': ['Pick the brand you meant from the suggestions.', 'If it’s none of them, score against reference brands instead.'],
  'brand-not-in-qloo': ['Paste a short description of your brand, or its web page.', 'Or enter 1–3 reference brands with a similar audience that are in Qloo.'],
  'reference-not-in-qloo': ['Replace the reference brands Qloo doesn’t have; the suggestions show names Qloo knows.'],
  'description-unreadable': ['Paste the description as text instead of a URL.', 'Or enter 1–3 reference brands.'],
  'description-too-few-names': [
    'Add 1–3 reference brands with a similar audience that are in Qloo.',
    'Or add the brands, artists, films or places your brand is inspired by to the description.',
  ],
  'llm-unavailable': ['Name extraction is temporarily unavailable. Try again in a few minutes.'],
  'too-few-creator-entities': [
    'Add 2–3 videos whose titles or descriptions explicitly name brands, products or topics.',
    'Or paste the creator’s channel URL: its latest 15 videos are read, not just the ones you picked.',
  ],
  'no-affinity': ['Try a different creator or brand; Qloo has no affinity data for this pair.'],
  'too-few-dimensions': [
    'Add 2–3 videos that cover other kinds of things (music, films, places, brands), so more than one area of taste is scored.',
    'Or paste the creator’s channel URL: its latest 15 videos are read.',
  ],
  'no-candidates': ['Choose “Any YouTuber” as the creator type, or a broader one.'],
  'too-few-profile-entities': ['Analyze this creator’s videos instead, which adds what the creator talks about.'],
};

// The cause in a few plain words. For too few creator entities it depends on how far the
// chain got: no names proposed, names Qloo didn't match, or fewer than 3 confirmed.
export function noDataCause(reason: NoDataReason, creator?: { keywords: string[]; entities: unknown[] }): string {
  if (reason === 'too-few-creator-entities' && creator) {
    if (!creator.keywords.length) return 'No names extracted from the videos';
    if (!creator.entities.length) return 'No Qloo match for any name in the videos';
    return `Fewer than 3 verified entities (Qloo confirmed ${creator.entities.length})`;
  }
  const causes: Record<NoDataReason, string> = {
    'brand-name-mismatch': 'No exact Qloo match for the brand name',
    'brand-not-in-qloo': 'The brand isn’t in Qloo',
    'reference-not-in-qloo': 'A reference brand isn’t in Qloo',
    'description-unreadable': 'The brand description couldn’t be read',
    'description-too-few-names': 'Fewer than 3 verified entities in the brand description',
    'llm-unavailable': 'No names extracted: no language model answered',
    'too-few-creator-entities': 'Fewer than 3 verified entities from the videos',
    'no-affinity': 'Qloo returned no affinity for this pair',
    'too-few-dimensions': 'Fewer than 2 taste dimensions with 3+ scored entities',
    'no-candidates': 'Qloo returned no creators for this brand and type',
    'too-few-profile-entities': 'Too little of the creators’ audience taste was scored',
  };
  return causes[reason];
}
