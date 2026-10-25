# Qloo integration

Everything below was verified against `https://hackathon.api.qloo.com` with real requests on 2026-10-25. Code: [`lib/qloo.ts`](../lib/qloo.ts).

## Endpoints used

Only two, both `GET` with parameters in the query string and the header `X-Api-Key: <QLOO_API_KEY>`.

### `GET /search`

```
/search?query=Apple&take=5&types=urn:entity:brand
```

```json
{
  "results": [
    {
      "entity_id": "D5B78065-6DBB-4DDB-80DF-6495B9B1006B",
      "name": "Apple Inc",
      "types": ["urn:entity:brand"],
      "popularity": 0.9992,
      "properties": { "akas": [{ "value": "Apple" }], "industry": ["..."] },
      "tags": [{ "tag_id": "urn:tag:genre:brand:electronics", "type": "urn:tag:genre:brand" }]
    }
  ]
}
```

- `types` accepts a comma-separated list and does filter results.
- `/search` returns `popularity`, **not** affinity.
- Search tags carry `tag_id`; insights tags (below) carry `id`.

### `GET /v2/insights`

```
/v2/insights?filter.type=urn:entity:movie&signal.interests.entities=<id,id,...>&take=5
```

```json
{
  "results": {
    "entities": [
      { "entity_id": "...", "name": "...", "popularity": 0.97, "tags": [{ "id": "urn:tag:genre:..." }], "query": { "affinity": 0.94 } }
    ]
  }
}
```

- `filter.type` is **required** (`400 filter.type is required` without it), so mixed-type requests are split per type.
- Verified types: brand, artist, movie, tv_show, place, destination, book, podcast, videogame, person.
- `filter.results.entities=<ids>` scores exactly those entities against the signal. This is how CreatorPulse gets “how strongly does the brand’s audience relate to each creator entity”.

### Rate limits

From the response headers: **10 requests/second** (`x-second-ratelimit-*`) and **50,000 requests/month** (`x-month-ratelimit-*`). Exceeding the per-second limit returns `429`.

## How CreatorPulse calls Qloo

| Purpose | Call | Signal | Result used |
|---|---|---|---|
| Brand entity | `/search`, `types=urn:entity:brand` | – | Exact name/alias match, most popular wins |
| Brand cultural proxies | `/v2/insights` × 6 types | brand | Top 5 per type, with affinity |
| Creator entities | `/search`, types from Gemini’s hint | – | Exact name/alias match only |
| Creator cross-domain expansion | `/v2/insights` × 6 types | creator entities (brand excluded) | Top 5 per type |
| Scoring | `/v2/insights` per type, `filter.results.entities` | brand | Affinity of every creator entity |

A cold match takes roughly 60 Qloo requests (5–12 s at the throttle below). Responses are cached for an hour, so repeating a match is near-instant and returns the same numbers.

## Pitfalls found while testing, and how they are handled

1. **Search is fuzzy.** Searching brands for “iPhone” returns Strava; an unfiltered “Apple” returns a video game first. → Only results whose `name` or one of `properties.akas` equals the query (case- and punctuation-insensitive) are accepted. Everything else is reported as *not found*.
2. **Common words match real entities.** “Duo” matched an artist, “Fun” the band fun. → In rule-based fallback mode a single word may only resolve to a brand. With Gemini, each name comes with a kind that narrows the search types.
3. **Local businesses flood product-name searches** (“iPhone” → repair shops). → `urn:entity:place` is excluded from creator search.
4. **Affinities are compressed** into roughly 0.55–0.98. → Rescaled from [0.5, 1.0] to [0, 100] before scoring.
5. **Non-English brand names are unreliable.** “蘋果” and “耐吉” are not Qloo aliases of Apple and Nike, “華碩” returns unrelated brands. → The UI asks for English brand names, and an unknown brand is reported, never substituted.
6. **Rate limit.** → A process-wide throttle spaces requests 125 ms apart (8/s), and a `429` is retried once after `x-second-ratelimit-reset`.
7. **No location signal is sent**, so destination and place proxies can skew regionally (Gulf cities appeared for several brands).

## What is deliberately not done

- No guessed entity IDs: IDs are stored exactly as Qloo returns them.
- No LLM-generated taste signals: an LLM-proposed name counts only after Qloo confirms it.
- No score without evidence: fewer than 3 creator entities, or no brand match, returns `insufficient-data`.
