# Demo pair

The **Run demo** button uses this input. It is defined in [`lib/demo-pair.ts`](../lib/demo-pair.ts) and repeated in [`scripts/save-demo-snapshot.mjs`](../scripts/save-demo-snapshot.mjs); change both together.

| Field | Value |
|---|---|
| Brand | Apple (category: Technology) |
| Creator | Marques Brownlee (@mkbhd) |
| Videos | The channel’s five most recent uploads when chosen (2026-10-25) |

1. https://www.youtube.com/watch?v=_4ELeWAgMwo · ASMR iPhone Duo Unboxing
2. https://www.youtube.com/watch?v=ESABTN4VtrA · iPhone Duo Review: First Generation Fun!
3. https://www.youtube.com/watch?v=scwlR0QHGOk · The NEW Tesla Roadster: My Honest Reaction
4. https://www.youtube.com/watch?v=QVv3mQzlrN0 · Apple Homeview Impressions: Not Convinced!
5. https://www.youtube.com/watch?v=_0G4OG39XjI · WTF is a Googlebook?

## Checks

- [x] Channel public; all five videos readable through YouTube Data API `videos.list`
- [x] At least 3 Qloo entities: Gemini proposed names, Qloo confirmed 7 (Dbrand, Apple Inc, Tesla, Hagerty, Google, Asus, Dell Inc), several from sponsor mentions in descriptions
- [x] Full run: Fit Score 75, confidence 100, moderate fit, about 12 seconds
- [x] All five dimensions have data

## Why this pair

- A tech reviewer and a tech brand: the score and its reasons are easy to sanity-check.
- Descriptions name sponsors (Dell, Asus, dbrand), which gives Qloo plenty of entities to resolve.
- A counter-example: a cooking channel resolved only 3 entities, and its Food & Travel dimension was driven by UK cities rather than food, because dishes are not Qloo entities. Not a good first impression.

## Snapshot: pinned entities and fallback

[`data/demo-snapshot.json`](../data/demo-snapshot.json) is a complete, real `/api/match` result for this pair.

**Pinned entities.** Gemini’s extraction varied slightly between server instances (the same videos scored 74 on one and 75 on another), which breaks “same input, same score”. So the demo pair starts from the creator entities stored in the snapshot instead of re-running Gemini. YouTube is still read and every Qloo expansion and affinity is still fetched live. Verified on 2026-10-25: Fit 75 with identical dimension scores before and after a server restart (all caches cleared). The Sources panel shows “fixed for the demo pair”.

**Fallback.** If a live demo run throws (verified by pointing `QLOO_BASE_URL` at an unreachable address: the demo returned the snapshot in 0.3 s, while a non-demo match returned a clear 502 error), `/api/match` serves the snapshot instead, and the page labels it “Cached result from [date]”.

Regenerate it before a demo, with the dev server running:

```bash
node scripts/save-demo-snapshot.mjs
```

The script asks for fresh Gemini extraction (`pinDemoEntities: false`) and refuses to save anything except a live, Gemini-backed, fully scored result. Regenerating changes the pinned entities, so re-check the demo score afterwards.
