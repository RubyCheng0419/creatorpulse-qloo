# CreatorPulse

**Cultural compatibility due diligence for brand × creator partnerships, built on Qloo’s cross-domain taste graph.**

Most influencer-matching tools rank creators by follower counts, engagement rates and audience demographics. CreatorPulse asks a different question: *will this partnership clash culturally?* It compares what a brand’s audience likes across music, film, TV, travel and other brands with what a creator’s content is about, and every point of the resulting **Fit Score** traces back to specific Qloo entities.

- **Live demo:** https://creatorpulse-qloo.vercel.app/
- **Try it:** open the demo and click **Run demo: Apple × MKBHD**. No sign-in, about 10–20 seconds.

## What you get

For a brand name and 1–5 YouTube videos from a creator:

- **Fit Score (0–100)** with a confidence value and a verdict (strong / moderate / weak / no fit)
- **Five taste dimensions**: Tech & Innovation, Film/TV & Entertainment, Music, Lifestyle & Fashion, Food & Travel
- **Evidence for every dimension**: the Qloo entities behind the score, each with its Qloo entity ID, its affinity, and whether it was named in the videos or reached through cross-domain expansion
- **Culture clash, recommendations and risks**, each sentence built from those entities
- **A two-page PDF report** with the same content as the page
- **An Agent Trace**: every tool call (YouTube, Gemini, each Qloo request) and every decision behind the result, in order, with timings and whether each Qloo response was live or served from cache

If Qloo cannot back a score with evidence (unknown brand, too few entities), CreatorPulse says *insufficient data* instead of inventing a number.

## Why Qloo is essential

Remove Qloo and there is no score. Every number comes from Qloo:

| Step | Qloo call | What it provides |
|---|---|---|
| Resolve the brand | `GET /search` (brands only) | The brand’s Qloo entity |
| Resolve the creator’s taste | `GET /search` | Entities named in the videos (brands, artists, shows, people…) |
| Expand across domains | `GET /v2/insights` with the creator’s entities as signal | Music, film, TV, places and brands that audience also likes |
| Brand cultural proxies | `GET /v2/insights` with the brand as signal | What the brand’s audience likes, per domain |
| **Score** | `GET /v2/insights` with the brand as signal and `filter.results.entities` = the creator’s entities | **How strongly the brand’s audience relates to each creator entity (affinity)** |

The last call is the core of the product: Qloo directly answers “how much does Apple’s audience like Tesla, *Halt and Catch Fire* and Zedd?”. A language model has no way to produce those affinities, and CreatorPulse never lets it try.

## How it works

```
YouTube URLs ──► YouTube Data API v3 (videos.list, channels.list)
                     │  titles, descriptions, tags
                     ▼
                 Gemini proposes names explicitly mentioned (search terms only)
                     │
                     ▼
                 Qloo /search ── exact name or Qloo alias match only ──► creator entities
                     │
                     ▼
Brand name ────► Qloo /search ──► brand entity ──► Qloo /v2/insights ──► cultural proxies
                     │
                     ▼
                 Qloo /v2/insights: cross-domain expansion of the creator’s entities
                     │
                     ▼
                 Qloo /v2/insights: affinity of each creator entity, brand as signal
                     │
                     ▼
                 lib/scoring.ts (fixed formula) ──► Fit Score, dimensions, evidence
                     │
                     ▼
                 lib/report.ts (template) ──► summary, culture clash, recommendations, risks
```

### Scoring (fixed formula, no LLM)

The score is computed in [`lib/scoring.ts`](lib/scoring.ts); the same Qloo data always gives the same score.

1. **Creator entities**: entities named in the videos (weight 1.0) plus Qloo’s cross-domain expansion of them (weight 0.5). The brand itself is excluded from the expansion signal, so a creator who mentions Apple doesn’t inherit Apple’s own proxies.
2. **Affinity**: for each creator entity, Qloo’s affinity with the brand as signal.
3. **Calibration**: observed affinities sit between ~0.55 and ~0.98, so affinity is rescaled linearly from [0.5, 1.0] to [0, 100]. Without this every pair would land between 75 and 95.
4. **Dimensions**: by Qloo entity type; brands by majority vote over their Qloo genre tags (`electronics`, `automotive` → Tech; `fashion` → Lifestyle; `food_and_beverage`, `travel` → Food & Travel…).
5. **Shared taste** is affinity ≥ 0.85; **clash** is affinity < 0.70: evidence of mismatch, not missing data.
6. **Dimension score** = weighted mean; **Fit Score** = equal-weight mean of the dimensions that have data. Dimensions without data are excluded, never counted as zero.
7. **Confidence** measures how much of the score rests on entities the creator actually named rather than on cross-domain inference: 35% named entities scored (full marks at 10) + 25% dimensions with data + 40% share of the score’s weight that comes from named entities (full marks at half). These weights are a judgement call. An earlier formula saturated at 100 for 9 of 12 test brands, so it carried no information; the current one ranges from about 44 (3 named entities) to 100.

Below 3 creator entities, or when Qloo has no exact match for the brand, there is no score.

### Agent Trace

Each result carries a trace of the run, recorded as it happens: the YouTube calls, the Gemini call and what it proposed, every Qloo `/search` with why its result was accepted or rejected (e.g. “iPhone Duo” → Strava, Duo Security, Duolingo: no exact match, rejected), every `/v2/insights` request, and the rule-based decisions: the evidence threshold, excluding the brand from its own expansion, dimension assignment, the score and the verdict. Qloo and YouTube calls are marked *live* or *cached*.

### Where the LLM fits (and where it doesn’t)

Gemini (`gemini-3.5-flash`) reads video titles, descriptions and tags and proposes names that are **explicitly mentioned**, e.g. a sponsor in a description. These are only search terms: a name becomes evidence only if Qloo returns an entity whose name or Qloo alias matches it exactly. Gemini never sees or produces scores, entities or report text.

If Gemini is unavailable (for example, its quota is used up), **no score is given.** An earlier rule-based keyword fallback produced wrong but Qloo-confirmable evidence (“TIME” → *Time* magazine, “INDIAN FOOD” → a book of that name), which is worse than no answer, so it was removed. The demo pair falls back to its labelled snapshot instead.

### Details that keep the evidence honest

- Qloo search is fuzzy (searching brands for “iPhone” returns Strava), so only exact name/alias matches are accepted; everything else is listed as *not found*.
- Gemini tags each name with a kind (brand, artist, show, person…), which narrows the Qloo search: “Duo” from “iPhone Duo” no longer matches an artist called Duo.
- Local businesses (`urn:entity:place`) are excluded from creator search; they dominated fuzzy matches for product names.
- Requests are throttled under Qloo’s 10 requests/second limit and retried once on 429/5xx.
- The public API is rate-limited per IP (5 matches per minute), so a public demo can’t drain the Gemini, Qloo and YouTube quotas. The limit is kept in memory per server instance: a guard against bursts, not a global quota.

More detail, including verified request/response shapes: [docs/QLOO_INTEGRATION.md](docs/QLOO_INTEGRATION.md).

## Run it locally

Requirements: Node.js 20+, and API keys for YouTube Data API v3, the Qloo hackathon API and Google Gemini.

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

Open http://localhost:3000 and click **Run demo**.

| Variable | Used for |
|---|---|
| `YOUTUBE_API_KEY` | `videos.list` and `channels.list` (never `search.list`, which costs 100 quota units) |
| `QLOO_API_KEY` | Qloo `/search` and `/v2/insights` |
| `QLOO_BASE_URL` | Defaults to `https://hackathon.api.qloo.com` |
| `GEMINI_API_KEY` | Name extraction; required for a score (without it every match returns *insufficient data*) |

### API

| Endpoint | Purpose |
|---|---|
| `POST /api/match` | Full pipeline. Body: `{ "videoUrls": [...], "brandName": "Apple", "category"?: "Technology" }`. Send `Accept: application/x-ndjson` to stream progress stages. |
| `POST /api/creator-taste` | Videos → Qloo-confirmed creator entities |
| `POST /api/brand-lookup` | Brand → Qloo entity and cultural proxies |

## Demo pair and fallback

The demo pair is Apple × Marques Brownlee (MKBHD), five recent videos: see [docs/DEMO_PAIR.md](docs/DEMO_PAIR.md). The demo runs the full pipeline every time: YouTube is read, Gemini is called, and Qloo resolves and scores the entities. Qloo responses may come from the server’s one-hour cache, and the Agent Trace marks each one as live or cached.

[`data/demo-snapshot.json`](data/demo-snapshot.json) holds a real result for the pair and is used only as a **fallback**: if a live demo run fails (Qloo, YouTube or Gemini down), the app shows the snapshot, clearly labelled as a cached result with its date.

Regenerate it with `node scripts/save-demo-snapshot.mjs` while the dev server runs.

## Known limitations

- **Creator taste comes from what the videos name.** Topics that are not Qloo entities (an air fryer, a cheesecake) cannot be matched, so a cooking channel may score low on Food & Travel. CreatorPulse uses no audience personal data.
- **No location signal yet**, so place and destination proxies can skew toward particular regions.
- **Brand names must be in English**; Qloo’s matching of non-English brand names is unreliable.
- **Gemini output varies between calls** (Gemini is never cached). Qloo’s exact-match check absorbs most of it: two demo runs where Gemini proposed 13 and 12 names both confirmed the same 7 Qloo entities and scored 75. When the confirmed set does differ, the score moves: the same five videos scored Samsung 77 on one run and 71 on another.
- **History is stored in the browser** (localStorage), so `/match/[id]` links only open on the device that ran the match.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Google Gen AI SDK · YouTube Data API v3 · Qloo hackathon API

## License

[MIT](LICENSE)
