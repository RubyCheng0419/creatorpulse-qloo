# CreatorPulse

**Cultural compatibility due diligence for brand × creator partnerships, built on Qloo’s cross-domain taste graph.**

Most influencer-matching tools rank creators by follower counts, engagement rates and audience demographics. CreatorPulse asks a different question: *does this creator’s world share the brand audience’s taste?* It compares what a brand’s audience likes across music, film, TV, travel and other brands with what a creator’s content and audience are about, and every point of the resulting **Fit Score** traces back to specific Qloo entities.

Two modes, one scoring formula:

- **Find creators** (`/discover`): enter your brand; Qloo ranks its YouTubers by your audience’s affinity, and each one gets a Fit Score from their audience’s taste in Qloo.
- **Check a creator** (`/`): you already have a creator in mind; paste 1–5 videos or a channel URL for due diligence on what the creator actually talks about.

- **Live demo:** https://creatorpulse-qloo.vercel.app/
- **Try it:** click **Run demo: Apple × MKBHD**, or open **Find creators** and click **Find creators for Huggies**. No sign-in, about 10–20 seconds.

## What you get

**Find creators**, for a brand (or reference brands, a description or a key visual if the brand isn’t in Qloo) and an optional creator type:

- **Ten YouTubers from Qloo**, ranked, each with a Fit Score, confidence, the brand audience’s affinity for the creator (*audience overlap*), strongest and weakest dimension, shared taste and clashes, and the full evidence on demand
- **A link into Check a creator** for each one whose YouTube channel could be matched, to add what the creator’s own videos say
- **Projects** (`/projects`): save one campaign’s brand inputs and every ranking found with them (stored in the browser)

**Check a creator**, for a brand name and 1–5 YouTube videos or one channel URL (its latest 15 videos):

- **Fit Score (0–100)** with a confidence level (High / Medium / Low) and a verdict (strong / moderate / weak / no fit)
- **Five taste dimensions**: Tech & Innovation, Film/TV & Entertainment, Music, Lifestyle & Fashion, Food & Travel
- **Evidence for every dimension**: the Qloo entities behind the score, each with its Qloo entity ID, its affinity, and whether it was named in the videos or reached through cross-domain expansion
- **Culture clash, recommendations and risks**, each sentence built from those entities
- **A two-page PDF report** with the same content as the page
- **An Agent Trace**: every tool call (YouTube, Gemini, each Qloo request) and every decision behind the result, in order, with timings and whether each Qloo response was live or served from cache

If Qloo cannot back a score with evidence (unknown brand, too few entities), CreatorPulse says *insufficient data* instead of inventing a number, with the reason as a fixed category and what to try next.

## Why Qloo is essential

Remove Qloo and there is no score. Every number comes from Qloo:

| Step | Qloo call | What it provides |
|---|---|---|
| Resolve the brand | `GET /search` (brands only) | The brand’s Qloo entity |
| Resolve the creator’s taste | `GET /search` | Entities named in the videos (brands, artists, shows, people…) |
| Expand across domains | `GET /v2/insights` with the creator’s entities as signal | Music, film, TV, places and brands that audience also likes |
| Brand cultural proxies | `GET /v2/insights` with the brand as signal | What the brand’s audience likes, per domain |
| **Score** | `GET /v2/insights` with the brand as signal and `filter.results.entities` = the creator’s entities | **How strongly the brand’s audience relates to each creator entity (affinity)** |

Find creators adds three Qloo calls: `/v2/insights` for people with `filter.tags=urn:tag:genre:person:youtuber` (or a category such as `technology_youtubers`) and the brand as signal, to rank candidates; `/v2/insights` with each candidate as signal, to read their audience’s taste per domain; and the same scoring call as above, batched for all candidates.

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
7. **Confidence** is a level, not a number, and only counts evidence: **High** with 10 or more confirmed entities named in the videos and data in all five dimensions, **Medium** with 5–9, **Low** with fewer than 5. The result page states what it is based on (“Confidence based on N confirmed entities across M dimensions”). Earlier numeric formulas either saturated at 100 or looked more precise than they were.

When the videos name fewer than 3 Qloo entities (or no LLM can extract names), Check a creator falls back to the creator’s own Qloo entity, if the channel’s title or handle is that person’s exact name or alias and Qloo tags them as a creator: the score then comes from their audience’s taste, as in Find creators, labelled “Scored from X’s audience taste in Qloo”, with confidence at most Medium. Without such a person, or when no brand side can be built from Qloo (see below), there is no score. Whenever the person is found, the brand audience’s affinity for them is shown as *audience overlap*, not scored.

### Find creators: scoring from audience taste

[`lib/discover.ts`](lib/discover.ts) uses the same formula, with one difference in what the creator side is:

1. **Candidates**: Qloo people with a YouTuber tag, ranked by the brand audience’s affinity (`/v2/insights`, `filter.type=urn:entity:person`). Qloo tags about 900 people as YouTubers.
2. **Audience taste**: for each candidate, the creator’s Qloo entity as signal, top 5 per type (brands, artists, films, TV, destinations, places): up to 30 entities, no YouTube or LLM call needed.
3. **Weight 0.5** for every one of them: it is Qloo’s inference of what the audience likes, one step removed, like the cross-domain expansion in a match. There is no weight-1.0 tier unless the creator’s videos are analyzed too.
4. **Score** with the brand as signal, one batched call per type for all candidates, then the same rescaling, tiers, dimensions and Fit Score as a match.
5. **Confidence is at most Medium** (20+ scored entities across 4+ dimensions; otherwise Low), and fewer than 10 scored entities gives that creator no score.
6. **Audience overlap** (the brand audience’s affinity for the creator) is shown but not scored, so the same evidence isn’t counted twice; it only breaks ties.
7. Queries that fail (timeouts, dropped connections, 429) are asked again after the rest and reported per creator; a creator Qloo can’t use as a signal for a type (400) is reported as having no data there, not retried.

Checked on 2026-10-27: two live runs per brand gave identical rankings, and for common-sense controls the creator type that should fit scored higher on average in all four cases (Razer: gaming 71 vs beauty 55; Fenty Beauty: beauty 74 vs gaming 57; Apple: technology 64 vs beauty 58; Huggies: lifestyle 53 vs gaming 51, the weakest, since Qloo has no family category).

### When the brand isn’t in Qloo

Niche brands often have no Qloo entity. Instead of a dead end, the user can build the brand side another way, and the result says which:

1. **Reference brands (first choice).** 1–3 brands with a similar audience that *are* in Qloo. Each must pass the same exact name/alias check; one that doesn’t is sent back to be replaced, never dropped silently. The verified brands are used together as the signal. Label: “Your brand isn’t in Qloo. Scored against your reference brands: …”.
2. **Brand description or web page.** Gemini lists the names the text explicitly mentions (same rules as for videos, at most 20), and only exact Qloo matches count. At least 3 are needed; slogans and adjectives name nothing, so generic copy falls back to asking for reference brands. Web pages are fetched server-side over https only, never from private addresses, with size and time limits. Label: “Scored from your brand description”.
3. **Tags, only as a supplement.** When reference brands give fewer than 3 entities and the user also described the brand, Gemini proposes style keywords, and only keywords that exactly name a Qloo taste tag (genre, subgenre, theme, keyword) from `GET /v2/tags` are added, by tag ID, as `signal.interests.tags`. Label: “Includes tag-based signal”.
4. **A key visual, also only a supplement** (Find creators). Gemini reads its visible style and the same exact-tag rule applies. An image rarely shows anything Qloo knows by name, so it never builds a brand side on its own. Label: “Includes tags inferred from your key visual”.

Each of these approximates the brand’s audience rather than measuring it, so **confidence drops one level** (High → Medium → Low) in both modes, and the Agent Trace records the step. Asking Gemini to *suggest* reference brands is future work: the user picks them today.

### Agent Trace

Each result carries a trace of the run, recorded as it happens: the YouTube calls, each LLM call and what it proposed, every Qloo `/search` with why its result was accepted or rejected (e.g. “iPhone Duo” → Strava, Duo Security, Duolingo: no exact match, rejected), every `/v2/insights` request, and the rule-based decisions: the evidence threshold, excluding the brand from its own expansion, dimension assignment, the score and the verdict. Every Qloo call records its HTTP attempts (“200”, “429 → 200 (retried)”, “400 (not retried)”), so a failed query is never mistaken for an empty result. Every Qloo, YouTube and LLM call is marked *live* or *cached* (Qloo is cached up to 1 hour; YouTube and Gemini up to 24 hours for the same set of videos), and **Run live** re-runs the match with every cache bypassed.

### Where the LLM fits (and where it doesn’t)

Gemini (`gemini-3.5-flash`) reads video titles, descriptions and tags and proposes names that are **explicitly mentioned**, e.g. a sponsor in a description. These are only search terms: a name becomes evidence only if Qloo returns an entity whose name or Qloo alias matches it exactly. Gemini never sees or produces scores, entities or report text.

If Gemini is over quota (429) or overloaded (503), the same prompt and JSON schema go to **Groq** (`openai/gpt-oss-120b`, temperature 0) once, for every LLM step: video names, brand-description names and keywords, and the retry decision. Its answer is cached for 24 hours like Gemini’s, and the page says which LLM answered (“Groq live”, “Groq cached”). Groq is held to the same rule: it only proposes search terms. Key visuals are read by Gemini only.

Find creators needs no LLM at all unless a description or key visual is given: candidates, audience taste and scores all come from Qloo.

If neither answers, **no score is given.** An earlier rule-based keyword fallback produced wrong but Qloo-confirmable evidence (“TIME” → *Time* magazine, “INDIAN FOOD” → a book of that name), which is worse than no answer, so it was removed. The demo pair falls back to its labelled snapshot instead.

### Details that keep the evidence honest

- Qloo search is fuzzy (searching brands for “iPhone” returns Strava), so only exact name/alias matches are accepted; everything else is listed as *not found*.
- Gemini tags each name with a kind (brand, artist, show, person…), which narrows the Qloo search: “Duo” from “iPhone Duo” no longer matches an artist called Duo.
- Local businesses (`urn:entity:place`) are excluded from creator search; they dominated fuzzy matches for product names.
- Requests are throttled under Qloo’s 10 requests/second limit and retried once on 429/5xx.
- The public API is rate-limited per IP (5 matches per minute), so a public demo can’t drain the Gemini, Qloo and YouTube quotas. The limit is kept in memory per server instance: a guard against bursts, not a global quota.

More detail, including verified request/response shapes: [docs/QLOO_INTEGRATION.md](docs/QLOO_INTEGRATION.md).

### How often there is no score

Measured on 2026-10-27 with ten channels of different kinds (cooking, kids, food travel, fitness, classical music, beauty, gaming, two Taiwanese channels with Chinese titles) against one brand:

| Input | No score |
|---|---|
| The latest 5 videos (the original input) | 3 of 10 |
| The channel URL (latest 15 videos) | 2 of 10 |
| The channel URL, with the creator’s Qloo entity as fallback | 1 of 10 |

The two channels the fallback recovered (a beauty channel and a Taiwanese one) named only 0–1 Qloo entities in 15 videos. The remaining one was a run where neither Gemini nor Groq answered; the same channel scored on the run before. Every no-score result carries a reason category, so this can be re-measured.

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
| `YOUTUBE_API_KEY` | `videos.list`, `channels.list` and `playlistItems.list` (never `search.list`, which costs 100 quota units) |
| `QLOO_API_KEY` | Qloo `/search` and `/v2/insights` |
| `QLOO_BASE_URL` | Defaults to `https://hackathon.api.qloo.com` |
| `GEMINI_API_KEY` | Name extraction; a score needs this or `GROQ_API_KEY` (without either every match returns *insufficient data*) |
| `GROQ_API_KEY` | Optional fallback for name extraction when Gemini returns 429 or 503 ([console.groq.com](https://console.groq.com)); `GROQ_MODEL` overrides the model |

### API

| Endpoint | Purpose |
|---|---|
| `POST /api/match` | Full pipeline. Body: `{ "videoUrls": [...], "brandName": "Apple", "category"?: "Technology", "referenceBrands"?: ["Byredo"], "brandDescription"?: "text or https:// URL" }` (the last two are used only when the brand isn’t in Qloo). Send `Accept: application/x-ndjson` to stream progress stages. |
| `POST /api/discover` | Find creators. Body: `{ "brandName": "Huggies", "creatorCategory"?: "technology", "referenceBrands"?: [...], "brandDescription"?: "...", "image"?: { "data": "<base64>", "mimeType": "image/jpeg" } }` |
| `POST /api/creator-taste` | Videos → Qloo-confirmed creator entities |
| `POST /api/brand-lookup` | Brand → Qloo entity and cultural proxies |
| `GET /api/health` | Which LLM keys this deployment has, and whether Groq accepts its key (never returns a key) |

## Demo pair and fallback

The demo pair is Apple × Marques Brownlee (MKBHD), five recent videos: see [docs/DEMO_PAIR.md](docs/DEMO_PAIR.md). The demo runs the full pipeline every time: YouTube is read, Gemini is called, and Qloo resolves and scores the entities. Qloo responses may come from the server’s one-hour cache, and the Agent Trace marks each one as live or cached.

[`data/demo-snapshot.json`](data/demo-snapshot.json) holds a real result for the pair and is used only as a **fallback**: if a live demo run fails (Qloo, YouTube or Gemini down), the app shows the snapshot, clearly labelled as a cached result with its date.

Regenerate it with `node scripts/save-demo-snapshot.mjs` while the dev server runs.

## Known limitations

- **Check a creator: taste comes mainly from what the videos name.** Topics that are not Qloo entities (an air fryer, a cheesecake) cannot be matched. A channel URL reads 15 videos instead of 5, which helps: a cooking channel that named too little in five videos confirmed 7 entities from its channel. CreatorPulse uses no audience personal data.
- **Find creators only knows Qloo’s YouTubers**: about 900, mostly well known, English- and Spanish-speaking. Only two are tagged as Taiwanese YouTubers. Creator types come from Wikipedia categories, so coverage is uneven, and there is no family category.
- **Not every creator has a matched channel.** Qloo has no YouTube links; a channel is accepted only if its title is the person’s name and it has an audience, so some creators (e.g. Cole LaBrant, whose channel is “The LaBrant Fam”) have a score but no video deep dive.
- **Scores measure cultural fit only**, not brand safety, past controversies or audience size.
- **No location signal yet**, so place and destination proxies can skew toward particular regions.
- **Brand names must be in English**; Qloo’s matching of non-English brand names is unreliable.
- **Brands outside Qloo are approximated**, by reference brands or by the Qloo entities their description names, and labelled as such with lower confidence.
- **LLM output varies between calls** (Check a creator only). Answers are cached for 24 hours per set of videos, so repeating a match on the same server gives the same names. Across servers or after the cache expires, the confirmed entities can differ and the score moves: the Apple × MKBHD demo has scored between 69 and 75 on live runs. Find creators doesn’t depend on an LLM and gave identical rankings on repeated live runs.
- **History is stored in the browser** (localStorage), so `/match/[id]` links only open on the device that ran the match.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Google Gen AI SDK · Groq (OpenAI-compatible API) · YouTube Data API v3 · Qloo hackathon API

## License

[MIT](LICENSE)
