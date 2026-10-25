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

## Live runs and the snapshot fallback

The demo runs the full pipeline every time: YouTube is read, Gemini proposes names, and Qloo resolves and scores the entities. Responses may come from the server’s cache (Qloo up to 1 hour; YouTube and Gemini up to 24 hours for the same set of videos), and the Agent Trace marks each call “live” or “cached”, including “Gemini live” / “Gemini cached”. “Run live” bypasses every cache.

Gemini’s proposals vary between calls, but Qloo’s exact-match check absorbs most of it: on 2026-10-25 two consecutive runs where Gemini proposed 13 and 12 names both confirmed the same 7 Qloo entities and scored 75.

[`data/demo-snapshot.json`](../data/demo-snapshot.json) is a complete, real `/api/match` result for this pair, used only as a **fallback**. If a live demo run throws, or Gemini is unavailable so no score can be given, `/api/match` serves the snapshot instead, and the page labels it “Cached result from [date]”. Verified by pointing `QLOO_BASE_URL` at an unreachable address: the demo returned the snapshot in 0.3 s, while a non-demo match returned a clear 502 error.

Regenerate it before a demo, with the dev server running:

```bash
node scripts/save-demo-snapshot.mjs
```

The script refuses to save anything except a live, Gemini-backed, fully scored result.
