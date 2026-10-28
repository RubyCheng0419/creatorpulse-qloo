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
- **The score’s range**, not one run as a fixed number: this run, the demo pair’s recorded range, the range across your runs of the pair on this device, and dimensions that moved 15+ points since the last run
- **Compare creators** (`/compare`): up to three creators for one brand side by side (Fit, confidence, strongest and weakest dimension, clashes); a saved demo comparison for Apple: MKBHD, Linus Tech Tips and a beauty creator
- **A share link** carrying the analysis’s inputs, which re-runs it on any device (History stays in the browser), and a **How the score works** page (`/how-it-works`) with every weight and threshold read from the scoring code
- **Sources** with each video’s publish date and views, and whether the videos are a channel’s latest uploads or the user’s picks

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
| Re-check the evidence | `GET /entities` | Every `/search`-confirmed entity (both sides) re-checked against Qloo’s own record by the same exact name/alias rule; its popularity, shown as “top X%” |
| Cross-check | `GET /v2/analysis/compare` (A = brand side, B = the creator’s confirmed entities) | The tags both sides share, with Qloo’s score: an independent second opinion shown beside the Fit Score, never part of it |

The cross-domain calls (expansion, a creator’s audience taste, the brand’s proxies) also send `filter.exclude.entities` (the brand side, so it never comes back as its own evidence), `filter.popularity.min=0.5` (obscure entities left out; destinations came back as low as 0.009) and `feature.explainability` (which signal entities each result came from, strongest first). Each was checked on 2026-10-27 to take effect for every `filter.type` used, since Qloo ignores unsupported parameters silently. The scoring call never gets a popularity filter: it would drop entities the videos named.

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
4. **Dimensions**: by Qloo entity type; brands by majority vote over their Qloo genre tags (`electronics`, `automotive` → Tech; `games`, `media` → Film, TV & Entertainment; `fashion` → Lifestyle; `food_and_beverage`, `travel` → Food & Travel…). A brand with no genre that votes lands in Lifestyle by default; a dimension made only of such brands still counts, but is labelled *classified by default* and is never named strongest or weakest, nor used for the decision.
5. **Shared taste** is affinity ≥ 0.85; **clash** is affinity < 0.70: evidence of mismatch, not missing data.
6. **Dimension score** = weighted mean; **Fit Score** = equal-weight mean of the *counted* dimensions: those with 3 or more entities. A dimension with 1–2 entities is shown, not counted; one without data is excluded, never counted as zero. Fewer than 2 counted dimensions gives no score.
7. **Confidence** is a level, not a number, and only counts evidence: **High** with 10 or more named entities scored and all five dimensions counted, **Medium** with 5 or more and at least 3 counted dimensions, **Low** otherwise. The result page states what it is based on (“Confidence based on N confirmed entities across M dimensions”). Earlier numeric formulas either saturated at 100 or looked more precise than they were.
8. **Unverified — do not use for a decision**: the score is shown, but without a verdict, with a Hold decision and no content recommendations, and the reason, when (E) a Qloo query that feeds the score failed after its retry, (L) confidence is Low, (I) the identity is unclear (videos from several channels, a ranked person with no YouTube channel, a Qloo person picked by the creator tag among namesakes), or (B) a creator check was scored from the creator’s audience taste instead of the videos. Judged per result ([`lib/unverified.ts`](lib/unverified.ts)); the reasoning is in [`debate/decision.md`](debate/decision.md).

When the videos name fewer than 3 Qloo entities (or no LLM can extract names), Check a creator falls back to the creator’s own Qloo entity, if the channel’s title or handle is that person’s exact name or alias and Qloo tags them as a creator: the score then comes from their audience’s taste, as in Find creators, labelled “Scored from X’s audience taste in Qloo”, with confidence at most Medium. Without such a person, or when no brand side can be built from Qloo (see below), there is no score. Whenever the person is found, the brand audience’s affinity for them is shown as *audience overlap*, not scored.

### Find creators: scoring from audience taste

[`lib/discover.ts`](lib/discover.ts) uses the same formula, with one difference in what the creator side is:

1. **Candidates**: Qloo people with a YouTuber tag, ranked by the brand audience’s affinity (`/v2/insights`, `filter.type=urn:entity:person`). Qloo tags about 900 people as YouTubers.
2. **Audience taste**: for each candidate, the creator’s Qloo entity as signal, top 5 per type (brands, artists, films, TV, destinations, places): up to 30 entities, no YouTube or LLM call needed.
3. **Weight 0.5** for every one of them: it is Qloo’s inference of what the audience likes, one step removed, like the cross-domain expansion in a match. There is no weight-1.0 tier unless the creator’s videos are analyzed too.
4. **Score** with the brand as signal, one batched call per type for all candidates, then the same rescaling, tiers, dimensions and Fit Score as a match.
5. **Confidence is at most Medium** (20+ scored entities across 4+ counted dimensions; otherwise Low), and fewer than 10 scored entities, or fewer than 2 counted dimensions, gives that creator no score. Creators within 5 points of the top score are shown as joint first (“1=”).
6. **Audience overlap** (the brand audience’s affinity for the creator) is shown but not scored, so the same evidence isn’t counted twice; it only breaks ties.
7. Queries that fail (timeouts, dropped connections, 429) are asked again after the rest and reported per creator; a creator Qloo can’t use as a signal for a type (400) is reported as having no data there, not retried.
8. **What was scored** is stated on every card: the creator’s Qloo person profile (person-level, covering everything Qloo links to that person, flagged when Qloo lists several roles), not a YouTube channel. A matched channel is shown with its handle and link, and is used only for the video deep dive. The evidence panel names the entities behind the strongest dimension, the dimensions without data, dimensions resting on fewer than 3 entities (shown, not counted), dimensions classified by default, and a main identity in Qloo’s description (e.g. “singer”) whose dimension isn’t the strongest.

**Is the ranking valid?** A ranking is checked before it is presented as a result ([`lib/ranking-controls.ts`](lib/ranking-controls.ts)). For the three demo brands, the default ranking (Any YouTuber) carries win/lose controls scored in the same request and batches: an obvious fit must be the top-ranked creator or score at least as high, and an obvious misfit must score 5+ points below the top. A ranking that fails is shown as **“Unverified — do not use for a decision”**, without fit verdicts; one whose control couldn’t be fully scored, or was picked by the creator tag among namesakes, is never marked validated; other brands are labelled not validated. Each ranked creator is also judged on its own (Low confidence, no YouTube channel, a failed query: see *Unverified* above).

Checked on 2026-10-28 with the dimension minimum (3 entities) and the Unverified rules:

| Brand | Top-ranked | Obvious fit | Obvious misfit | Result |
|---|---|---|---|---|
| Apple | Marques Brownlee 78 | Marques Brownlee 78 (#1) | Sandra Lee 50 | **Not validated**: the controls hold (misfit 28 below the top), but Qloo has 3 people named Sandra Lee and only the creator tag picked this one |
| Huggies | Cole LaBrant 66 | Cole LaBrant 66 (#1) | DrLupo 53 | **Validated**; Cole LaBrant and Sandra Lee (65) are joint first, and Cole LaBrant himself is Unverified (Low confidence, no YouTube channel matched) |
| Le Labo Fragrances | Alexis Alford 65 | Jeremy Fragrance 36 | DrLupo 32 | **Unverified** (2026-10-27, before the dimension minimum; not re-run); Jeremy Fragrance’s place profile also timed out |

On 2026-10-27, before the dimension minimum, Huggies was Unverified: Cole LaBrant’s Tech & Innovation rested on 1 entity (27) and still weighed a full share, which put him 4th. The weakest dimension is still the same for most creators (Food & Travel for 10/10 with Apple and Le Labo); the ranking reports whether leaving it out changes the top 3. That systematic drag is not corrected by the formula ([`debate/decision.md`](debate/decision.md) §4).

Checked on 2026-10-27: two live runs per brand gave identical rankings, and for common-sense controls the creator type that should fit scored higher on average in all four cases (re-checked after the popularity filter: Razer: gaming 71 vs beauty 56; Fenty Beauty: beauty 74 vs gaming 57; Apple: technology 64 vs beauty 58; Huggies: lifestyle 53 vs gaming 51, the weakest, since Qloo has no family category).

### When the brand isn’t in Qloo

Niche brands often have no Qloo entity. Instead of a dead end, the user can build the brand side another way, and the result says which:

1. **Reference brands (first choice).** 1–3 brands with a similar audience that *are* in Qloo. Each must pass the same exact name/alias check; one that doesn’t is sent back to be replaced, never dropped silently. The verified brands are used together as the signal. Label: “Your brand isn’t in Qloo. Scored against your reference brands: …”.
2. **Brand description or web page.** Gemini lists the names the text explicitly mentions (same rules as for videos, at most 20), and only exact Qloo matches count; with 3 or more, they are the signal. Label: “Scored from your brand description”.
3. **The brand’s own style**, when the description names fewer than 3 things Qloo knows (most small brands). The LLM lists the brand’s field and style words, translating where needed (童趣 → whimsical, 貓 → cats), and only words that exactly name a Qloo taste tag are used, preferring the tag Qloo attaches to brands (“casual” → `genre:brand:fashion:casual`, not the place-ambience tag of that name). Genre tags count only when they are brand genres: “cute” is also `genre:music:cute`, a kind of music rather than a look, so it isn’t used. At least 2 tags are needed; they become the signal on their own (`signal.interests.tags`). Label: “Scored from your brand’s style, as Qloo taste tags”. Checked on 2026-10-27: tags from a whimsical clothing brand’s site ranked Lazy Oaf and Sanrio above Rolex and Goldman Sachs, and the reverse for luxury and business tags.

Web pages are fetched server-side over https only, never from private addresses, with size and time limits. Shop platforms render pages in the browser, so the HTML is mostly a menu; for 91APP and Shopify shops, the platform’s public product data is read too (categories and the latest 40 product names), since product names describe a brand’s style. à la sha, a Taiwanese clothing brand on 91APP, went from 231 characters to 1,320, and from no score to a ranking led by fashion and family creators.
4. **Tags as a supplement.** When reference brands give fewer than 3 entities and the user also described the brand, Gemini proposes style keywords, and only keywords that exactly name a Qloo taste tag (genre, subgenre, theme, keyword) from `GET /v2/tags` are added, by tag ID, as `signal.interests.tags`. Label: “Includes tag-based signal”.
5. **A key visual, only a supplement** (Find creators). Gemini reads its visible style and the same exact-tag rule applies. An image rarely shows anything Qloo knows by name, so it never builds a brand side on its own. Label: “Includes tags inferred from your key visual”.

Each of these approximates the brand’s audience rather than measuring it, so **confidence drops one level** (High → Medium → Low) in both modes, and the Agent Trace records the step. Asking Gemini to *suggest* reference brands is future work: the user picks them today.

### Agent Trace

Each result carries a trace of the run, recorded as it happens: the YouTube calls, each LLM call and what it proposed, every Qloo `/search` with why its result was accepted or rejected (e.g. “iPhone Duo” → Strava, Duo Security, Duolingo: no exact match, rejected), every `/v2/insights` request, and the rule-based decisions: the evidence threshold, excluding the brand from its own expansion, dimension assignment, the score and the verdict. Every Qloo call records its HTTP attempts (“200”, “429 → 200 (retried)”, “400 (not retried)”), so a failed query is never mistaken for an empty result. Every Qloo, YouTube and LLM call is marked *live* or *cached* (Qloo is cached up to 1 hour; YouTube and Gemini up to 24 hours for the same set of videos), and **Run live** re-runs the match with every cache bypassed.

### Where the LLM fits (and where it doesn’t)

Gemini (`gemini-3.5-flash`) reads video titles, descriptions and tags and proposes names that are **explicitly mentioned**, e.g. a sponsor in a description. These are only search terms: a name becomes evidence only if Qloo returns an entity whose name or Qloo alias matches it exactly. Gemini never sees or produces scores, entities or report text.

If Gemini is over quota (429), overloaded (503) or doesn’t answer in time, the same prompt and JSON schema go to **Groq** (`openai/gpt-oss-120b`, temperature 0) once, for every LLM step: video names, brand-description names and keywords, and the retry decision. Its answer is cached for 24 hours like Gemini’s, and the page says which LLM answered (“Groq live”, “Groq cached”). Groq is held to the same rule: it only proposes search terms. Key visuals are read by Gemini only.

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

The demo pair is Apple × Marques Brownlee (MKBHD), five recent videos: see [docs/DEMO_PAIR.md](docs/DEMO_PAIR.md).

A demo click serves [`data/demo-snapshot.json`](data/demo-snapshot.json) (and `demo-snapshot-mismatch.json` for Huggies): a complete, real result of the full pipeline, labelled **“Cached demo result”** with its date, so repeated clicks while judging spend no Gemini, Groq, YouTube or Qloo quota. **Run live** (in the Agent Trace) is the explicit opt-in: it runs everything again with every cache bypassed, and the page says “Live run”. If that live run fails, the snapshot is served again, labelled as a fallback. When the fallback LLM (Groq) extracted the names, the result page says so neutrally; why Gemini didn’t answer stays in the Agent Trace.

Regenerate the snapshots with `node scripts/save-demo-snapshot.mjs [base-url]` against a running server; it asks for live runs and refuses anything but a completed, LLM-backed result.

## Known limitations

- **Check a creator: taste comes mainly from what the videos name.** Topics that are not Qloo entities (an air fryer, a cheesecake) cannot be matched. A channel URL reads 15 videos instead of 5, which helps: a cooking channel that named too little in five videos confirmed 7 entities from its channel. CreatorPulse uses no audience personal data.
- **Find creators is validated for Apple only.** Its Huggies and Le Labo Fragrances rankings fail their win/lose controls and are labelled unverified; brands without controls are labelled not validated. A person-level audience profile can rank a creator for a taste unrelated to their channel.
- **Find creators only knows Qloo’s YouTubers**: about 900, mostly well known, English- and Spanish-speaking. Only two are tagged as Taiwanese YouTubers. Creator types come from Wikipedia categories, so coverage is uneven, and there is no family category.
- **Not every creator has a matched channel.** Qloo has no YouTube links; a channel is accepted only if its title is the person’s name and it has an audience, so some creators (e.g. Cole LaBrant, whose channel is “The LaBrant Fam”) have a score but no video deep dive.
- **Scores measure cultural fit only**, not brand safety, past controversies or audience size.
- **A tags-only brand side is coarse.** Affinities against a few style tags span a narrower range than against a brand, and Qloo takes about 15 seconds to score places against tags alone, so places are left out then (Food & Travel uses destinations). Confidence for such a brand side is at most Low in Find creators.
- **No location signal yet**, so place and destination proxies can skew toward particular regions.
- **Brand names must be in English**; Qloo’s matching of non-English brand names is unreliable.
- **Brands outside Qloo are approximated**, by reference brands or by the Qloo entities their description names, and labelled as such with lower confidence.
- **LLM output varies between calls** (Check a creator only). Answers are cached for 24 hours per set of videos, so repeating a match on the same server gives the same names. Across servers or after the cache expires, the confirmed entities can differ and the score moves: the Apple × MKBHD demo has scored between 69 and 75 on live runs. Find creators doesn’t depend on an LLM and gave identical rankings on repeated live runs.
- **History is stored in the browser** (localStorage), so `/match/[id]` links only open on the device that ran the match.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Google Gen AI SDK · Groq (OpenAI-compatible API) · YouTube Data API v3 · Qloo hackathon API

## License

[MIT](LICENSE)
