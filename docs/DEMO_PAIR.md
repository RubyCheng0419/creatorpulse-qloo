# Demos

## Check a creator: Apple × MKBHD, and Huggies × MKBHD

The two buttons on the home page use the same five videos with two brands. They are defined in [`lib/demo-pair.ts`](../lib/demo-pair.ts) and repeated in [`scripts/save-demo-snapshot.mjs`](../scripts/save-demo-snapshot.mjs); change both together.

| Field | Value |
|---|---|
| Brands | Apple (category: Technology) · Huggies |
| Creator | Marques Brownlee (@mkbhd) |
| Videos | The channel’s five most recent uploads when chosen (2026-10-25) |

1. https://www.youtube.com/watch?v=_4ELeWAgMwo · ASMR iPhone Duo Unboxing
2. https://www.youtube.com/watch?v=ESABTN4VtrA · iPhone Duo Review: First Generation Fun!
3. https://www.youtube.com/watch?v=scwlR0QHGOk · The NEW Tesla Roadster: My Honest Reaction
4. https://www.youtube.com/watch?v=QVv3mQzlrN0 · Apple Homeview Impressions: Not Convinced!
5. https://www.youtube.com/watch?v=_0G4OG39XjI · WTF is a Googlebook?

### Checks

- [x] Channel public; all five videos readable through YouTube Data API `videos.list`
- [x] At least 3 Qloo entities: the LLM proposed names, Qloo confirmed 6–8 (Dbrand, Apple Inc, Tesla, Hagerty, Google, Asus, Dell Inc, sometimes The Ridge), several from sponsor mentions in descriptions
- [x] Apple: moderate fit, all five dimensions with data. Live runs on 2026-10-25 to 2026-10-29 scored between 68 and 75, depending on which names the LLM proposed (68 when it also lists the sponsor Ridge, Qloo’s The Ridge, which makes Lifestyle & Fashion count with 3 entities). Huggies × MKBHD: 36 to 45 over the same period
- [x] Huggies: Fit 36–37, no fit, with clashes in Tech & Innovation and Lifestyle & Fashion

### Why this pair

- A tech reviewer and a tech brand: the score and its reasons are easy to sanity-check, and a diaper brand on the same videos shows the score follows the brand, not the creator’s fame.
- Descriptions name sponsors (Dell, Asus, dbrand), which gives Qloo plenty of entities to resolve.
- A counter-example: a cooking channel resolved only 3 entities from five videos, because dishes are not Qloo entities. Its channel URL (15 videos) now confirms 7.

### Live runs and the snapshot fallback

[`data/demo-snapshot.json`](../data/demo-snapshot.json) and [`data/demo-snapshot-mismatch.json`](../data/demo-snapshot-mismatch.json) are complete, real `/api/match` results for the two pairs. A demo click serves them, labelled “Cached demo result” with their date, so judging spends no API quota. “Run live” runs the full pipeline (YouTube, an LLM proposing names, Qloo resolving and scoring) with every cache bypassed; if that live run throws, or no LLM is available so no score can be given, the snapshot is served instead, labelled “Cached … the live run could not complete”.

Snapshots saved on 2026-10-27 with the current pipeline (with each video’s publish date and views): Apple × MKBHD **74** (Gemini, 10 confirmed entities, 5 shared Qloo tags in the cross-check); Huggies × MKBHD **37** (Groq, 6 confirmed entities, 18 clashes, no shared tags). The two used different LLMs, so their entity sets differ; regenerate the mismatch when Gemini has quota to compare on the same names. A Groq-only regeneration of the Apple pair the same evening also scored 75, but with 5 confirmed entities (Low confidence), so the Gemini run was kept.

## Comparison: Apple × three creators

[`public/demo-compare.json`](../public/demo-compare.json), shown at `/compare?demo=1` and saved by `node scripts/save-demo-compare.mjs [base-url]`: Linus Tech Tips **76** (Medium), Marques Brownlee **74** (the snapshot above), NikkieTutorials **55** (Medium; her videos named too little, so the score comes from her audience’s taste in Qloo; 5 clashes). Apple’s audience is broad: the most distant creators tried scored 55–61 (a gun channel 61, Low); a beauty creator was kept as the mismatch. Two farm and kids channels gave no score (Qloo scored only 2 of their 3 confirmed entities).

Regenerate them with the dev server running:

```bash
node scripts/save-demo-snapshot.mjs
```

The script refuses to save anything except a fully scored, LLM-backed result.

## Find creators: Apple, Huggies, Le Labo Fragrances

The buttons on `/discover` rank Qloo’s YouTubers for three very different brands. They need no LLM, so there is no snapshot: Qloo is the only dependency.

Checked on 2026-10-27:

| Brand | Top of the ranking |
|---|---|
| Apple | Marques Brownlee 79, then tech and gaming creators (Logan Paul 69, Dakotaz 68, TheGrefg, DjMaRiiO…) |
| Huggies | Sandra Lee 65, LadBaby 59, Elle Fowler 59, Cole LaBrant 58, then beauty creators (Laura Lee, Tati Westbrook…) |
| Le Labo Fragrances | Alexis Alford 65, Michael Greenfield 63, then beauty creators (Ingrid Nilsen, Sylvia Jade, Wayne Goss…) |

Re-checked on 2026-10-27 after `filter.popularity.min=0.5` was added to the audience-taste calls: Huggies’ order changed (Cole LaBrant 64 → 58), the other two barely moved.

Win/lose controls (see the README): **Apple is validated**; **Huggies and Le Labo Fragrances are unverified** and their rankings show “Unverified — do not use for a decision”. For a demo of Find creators, start with Apple.

- [x] Two live runs per brand (every cache bypassed) gave identical rankings
- [x] Common-sense controls passed 4/4: for Razer, Fenty Beauty, Apple and Huggies, the creator type that should fit scored higher on average than one that shouldn’t (see the README)
- [x] About 10–20 seconds on a cold cache, about 70 Qloo calls
