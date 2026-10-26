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
  | 'no-affinity'; // Qloo scored none of the creator's entities against the brand

// For each cause: what the user can do next. Shown under the "insufficient data" message.
export const NO_DATA_NEXT_STEPS: Record<NoDataReason, string[]> = {
  'brand-name-mismatch': ['Pick the brand you meant from the suggestions.', 'If it’s none of them, score against reference brands instead.'],
  'brand-not-in-qloo': ['Enter 1–3 reference brands with a similar audience.', 'Or paste a short description or your brand’s web page.'],
  'reference-not-in-qloo': ['Replace the reference brands Qloo doesn’t have; the suggestions show names Qloo knows.'],
  'description-unreadable': ['Paste the description as text instead of a URL.', 'Or enter reference brands.'],
  'description-too-few-names': [
    'Add the brands, artists, films or places your brand is inspired by to the description.',
    'Or enter reference brands.',
  ],
  'llm-unavailable': ['Name extraction is temporarily unavailable. Try again in a few minutes.'],
  'too-few-creator-entities': [
    'Paste the creator’s channel URL instead: its latest 15 videos are read, not just the ones you picked.',
    'Pick videos whose titles or descriptions name brands, products, shows or people.',
  ],
  'no-affinity': ['Try a different creator or brand; Qloo has no affinity data for this pair.'],
};
