# Is the Fit Score right? How it was checked

“Cultural fit” has no answer key, so no test can show the score is *correct*. What can be checked is whether it is **consistent** (the same evidence always gives the same score) and whether it points the **right way** where the answer is obvious or can be observed. Run on 2026-10-29 with the code at `a4b6afa`. Scripts are in [`scripts/validate/`](../scripts/validate/), raw results in [`docs/validation/`](validation/).

| Check | Result | Chance level |
|---|---|---|
| 0. Consistency | Same confirmed entities → identical score in every run (6 local, 8 production live) | — |
| 1. Known groups (Find creators) | Right direction for **11 of 12 brands**, mean win rate **0.85** | 0.50 (P ≥ 11/12 by chance = 0.3%) |
| 2. Real sponsorships (Check a creator) | The creator who works with the brand ranks in the top half **9 of 9** times, mean percentile **0.81** | 0.50 (P by chance ≈ 0.1%) |
| 3. Human judgment | Blind survey and scorer ready; needs raters | — |
| 4. Campaign outcomes | Not possible without campaign data | — |

## 0. Consistency

`node scripts/validate/baseline-check.mjs <base-url>` runs the demo pairs live and checks two layers:
- **Scoring layer:** runs with the same confirmed entities must give the same Fit Score and dimension scores. A difference is a bug. None found.
- **Extraction layer:** which LLM answered and which names it listed. This varies between calls (temperature 0, near-tied choices; Groq when Gemini is over quota), which moves Apple × MKBHD between 68 (when the sponsor Ridge is listed) and 75. The same insufficient-data input gave the same cause and counts twice.

## 1. Known groups — Find creators

`node scripts/validate/validate-discover.mjs <base-url> <out.json>`. For each brand, Qloo’s top 10 YouTubers of a type that should fit and of one that shouldn’t. Find creators uses no LLM, so the run is deterministic. **Win rate**: the share of (fit-type creator, misfit-type creator) pairs where the fit-type creator scores higher.

| Brand | Should fit | Mean | Shouldn’t | Mean | Gap | Win rate | |
|---|---|---|---|---|---|---|---|
| Razer | gaming | 69.1 | beauty | 54.3 | +14.8 | 0.99 | ✅ |
| Logitech | gaming | 69.5 | fashion | 50.9 | +18.6 | 0.99 | ✅ |
| Fenty Beauty | beauty | 74.0 | gaming | 60.1 | +13.9 | 0.95 | ✅ |
| Sephora | beauty | 66.4 | technology | 46.7 | +19.7 | 0.99 | ✅ |
| Apple | technology | 63.0 | beauty | 57.8 | +5.2 | 0.70 | ✅ |
| Samsung | technology | 57.9 | fashion | 51.7 | +6.2 | 0.72 | ✅ |
| Gucci | fashion | 64.2 | gaming | 61.0 | +3.2 | 0.69 | ✅ |
| Zara | fashion | 67.7 | technology | 50.1 | +17.6 | 1.00 | ✅ |
| Spotify | music | 56.5 | beauty | 52.0 | +4.5 | 0.79 | ✅ |
| Fender | music | 70.7 | beauty | 48.9 | +21.8 | 1.00 | ✅ |
| Huggies | lifestyle | 53.7 | gaming | 55.3 | −1.6 | 0.42 | ❌ |
| Nintendo | gaming | 60.4 | fashion | 48.7 | +11.7 | 0.92 | ✅ |

- **Huggies is wrong:** Qloo has no parenting or family creator type, so lifestyle stands in, and it doesn’t separate them.
- **Mass-market brands separate weakly** (Apple, Samsung, Gucci, Spotify: 3–6 points): their audiences are broad.

## 2. Real sponsorships as the reference answer — Check a creator

`node scripts/validate/sponsor-scan.mjs <out.json> @handle…` lists the sites each creator links in their latest 15 video descriptions that are Qloo brands; social links, link shorteners, stores and the creator’s own sites are left out, and so were links that aren’t sponsorships (a LinkedIn profile, a music licence credit). `node scripts/validate/validate-sponsors.mjs <base-url> <out.json>` scores each of those brands against the same 8 creators (latest 15 videos each) and asks where the creator who works with it ranks. The brand itself is never scored, so naming the sponsor in a description can’t raise that creator’s score.

| Brand | Works with | Their Fit | Rank of 8 | Highest |
|---|---|---|---|---|
| Dbrand | Linus Tech Tips | 77 | **1** | Linus Tech Tips 77 |
| Dbrand | Marques Brownlee | 74 | **2** | Linus Tech Tips 77 |
| Lowe’s | MrBeast | 59 | **1** | MrBeast 59 |
| iFit | MrBeast | 52 | **2** | DC Rainmaker 53 |
| Marriott Hotels | MrBeast | 54 | **2** | Joeman 56 |
| Proton | Linus Tech Tips | 45 | **3** | Joeman 49 |
| Sony | Joeman | 74 | **3** | Linus Tech Tips 82 |
| Krispy Kreme | MrBeast | 61 | **3** | Joshua Weissman 65 |
| The Ridge | Marques Brownlee | 44 | **4** (tied) | DC Rainmaker 52 |

Pool: Marques Brownlee, Linus Tech Tips, Joeman, MrBeast, DC Rainmaker, Joshua Weissman, Ali Abdaal, NikkieTutorials.

Limits, stated plainly:
- **Small:** 9 pairs, 5 partner creators, 4 of the pairs are MrBeast’s.
- **Close margins:** many gaps are 1–3 points, inside the 68–75-style variation the LLM’s extraction alone can cause.
- **Partly category match:** tech brands score tech creators high (Sony, Dbrand) and Krispy Kreme ranks the cooking creator first. That is sensible, but it overlaps with check 1 rather than being fully independent evidence.
- **A sponsorship isn’t proof of fit,** only that the brand chose that creator.

## 3. Human judgment — ready, needs raters

[`docs/validation/blind-survey.csv`](validation/blind-survey.csv): the 8 brands × 8 creators of check 2 in shuffled order, without scores. Each rater fills `rank` (1 = best fit for that brand) and saves a copy. `node scripts/validate/blind-survey.mjs score docs/validation/validate-sponsors.json rater1.csv rater2.csv …` prints, per brand, the Spearman correlation between each rater and CreatorPulse, and how much the raters agree with each other: the ceiling the score should be compared with. At least 3 raters with marketing experience are needed. The scorer was checked with a rater who copies CreatorPulse’s order (0.99–1.00; ties in the scores keep some below 1).

## 4. Campaign outcomes — not possible yet

Whether a higher score predicts a better partnership needs real campaigns: for at least 30 brand × creator partnerships, the score computed before the deal and the outcome (engagement, clicks or conversions, brand mentions or comment sentiment, renewal), compared within one brand category. That needs a partner’s data and is post-hackathon work.

## What this does and doesn’t show

- **Shows:** the score is reproducible from the same evidence, and in two independent setups it points the right way far more often than chance (check 1: 11/12; check 2: 9/9 in the top half).
- **Doesn’t show:** that the score predicts campaign results, or that it separates creators finely for mass-market brands.
- **Known weak spots:** no family creator type (Huggies), small samples, a sponsorship test dominated by one creator, and part of the signal is category match. See also [`debate/decision.md`](../debate/decision.md) §6.
