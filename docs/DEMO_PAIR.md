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
- [x] Apple: moderate fit, all five dimensions with data. Live runs on 2026-10-25 to 2026-10-27 scored between 69 and 75, depending on which names the LLM proposed
- [x] Huggies: Fit 36–37, no fit, with clashes in Tech & Innovation and Lifestyle & Fashion

### Why this pair

- A tech reviewer and a tech brand: the score and its reasons are easy to sanity-check, and a diaper brand on the same videos shows the score follows the brand, not the creator’s fame.
- Descriptions name sponsors (Dell, Asus, dbrand), which gives Qloo plenty of entities to resolve.
- A counter-example: a cooking channel resolved only 3 entities from five videos, because dishes are not Qloo entities. Its channel URL (15 videos) now confirms 7.

### Live runs and the snapshot fallback

The demos run the full pipeline every time: YouTube is read, an LLM proposes names (Gemini, or Groq when Gemini is over quota), and Qloo resolves and scores the entities. Responses may come from the server’s cache (Qloo up to 1 hour; YouTube and the LLM up to 24 hours for the same set of videos), and the Agent Trace marks each call “live” or “cached”. “Run live” bypasses every cache.

[`data/demo-snapshot.json`](../data/demo-snapshot.json) and [`data/demo-snapshot-mismatch.json`](../data/demo-snapshot-mismatch.json) are complete, real `/api/match` results for the two pairs, used only as a **fallback**: if a live demo run throws, or no LLM is available so no score can be given, `/api/match` serves the snapshot instead, and the page labels it “Cached result from [date]”.

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
| Apple | Marques Brownlee 79, then tech and gaming creators (Logan Paul, DjMaRiiO, Dakotaz…) |
| Huggies | Sandra Lee 65, Cole LaBrant 64, then family and beauty creators (Elle Fowler, LadBaby…) |
| Le Labo Fragrances | Alexis Alford 64, Michael Greenfield 63, then beauty creators (Sylvia Jade, Ingrid Nilsen, Wayne Goss…) |

- [x] Two live runs per brand (every cache bypassed) gave identical rankings
- [x] Common-sense controls passed 4/4: for Razer, Fenty Beauty, Apple and Huggies, the creator type that should fit scored higher on average than one that shouldn’t (see the README)
- [x] About 10–20 seconds on a cold cache, about 70 Qloo calls
