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

- `signal.interests.tags=<tag ids>` can be sent next to `signal.interests.entities`. Tested on 2026-10-25 with every type above, alone and with `filter.results.entities`: all returned 200 and the tags changed the affinities. If Qloo ever rejects tags for a type (400), CreatorPulse retries that type without them and records it in the Agent Trace.

### `GET /v2/tags`

```
/v2/tags?filter.query=minimalism&take=10
```

```json
{ "results": { "tags": [{ "id": "urn:tag:genre:music:minimalism", "name": "Minimalism", "type": "urn:tag:genre:music", "parents": [{ "type": "urn:entity:artist" }] }] } }
```

- One of `filter.query`, `filter.tags`, `filter.tag.types`, `filter.parents.types`, `filter.popularity.min/max` or `filter.results.tags` is required; plain `query` returns 400.
- Matching is broad: “perfume” returns place categories (*Perfume store*) and an occupation tag named exactly *Perfume*; “streetwear” returns only *Streetwear Culture Influence* (an ambience tag). → Only tags whose name equals the keyword **and** whose kind is keyword, theme, style, genre or subgenre are used.
- Genre tags belong to one domain (`genre:music:*`, `genre:media:*` for books, `genre:brand:*`), and a style word often names one: “cute” and “kawaii” exactly name only music genres (plus place ambience and decor tags). For a brand, only genres attached to brands count (checked 2026-10-27); keyword, theme, style and subgenre tags are Qloo’s cross-domain vocabulary and always count.

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
| Brand not in Qloo | `/search` for each reference brand, or for names in the brand’s description | – | Exact name/alias match only; these replace the brand as signal above |
| Tag supplement | `/v2/tags`, `filter.query` | – | Exact-name taste tags, sent as `signal.interests.tags` |
| Find creators: candidates | `/v2/insights`, `filter.type=urn:entity:person`, `filter.tags=urn:tag:genre:person:youtuber` (or a category tag) | brand | Top 10 YouTubers, with the brand audience’s affinity |
| Find creators: audience taste | `/v2/insights` × 6 types | each candidate | Top 5 per type |
| Find creators: scoring | `/v2/insights` per type, `filter.results.entities` | brand | Affinity of every candidate’s audience-taste entities, batched for all candidates |
| Find creators: channel | `/search`, `types=urn:entity:person` | – | The same entity’s `properties.external` (Instagram, Twitter ids), tried as YouTube handles |

A cold match takes roughly 60 Qloo requests (5–12 s at the throttle below); a cold Find creators run about 70 (10–20 s). Responses are cached for an hour, so repeating a match is near-instant and returns the same numbers.

## Pitfalls found while testing, and how they are handled

1. **Search is fuzzy.** Searching brands for “iPhone” returns Strava; an unfiltered “Apple” returns a video game first. → Only results whose `name` or one of `properties.akas` equals the query (case- and punctuation-insensitive) are accepted. Everything else is reported as *not found*.
2. **Common words match real entities.** “Duo” matched an artist, “Fun” the band fun. → Gemini tags each name with a kind (brand, artist, show, person…), which narrows the search types.
3. **Local businesses flood product-name searches** (“iPhone” → repair shops). → `urn:entity:place` is excluded from creator search.
4. **Affinities are compressed** into roughly 0.55–0.98. → Rescaled from [0.5, 1.0] to [0, 100] before scoring.
5. **Non-English brand names are unreliable.** “蘋果” and “耐吉” are not Qloo aliases of Apple and Nike, “華碩” returns unrelated brands. → The UI asks for English brand names, and an unknown brand is reported, never substituted.
6. **Rate limit.** → A process-wide throttle spaces requests 125 ms apart (8/s), and a `429` is retried once after `x-second-ratelimit-reset`.
7. **No location signal is sent**, so destination and place proxies can skew regionally (Gulf cities appeared for several brands).
8. **Some people are not valid signals.** For a few Qloo people, `/v2/insights` with the person as signal returns `400 All of the provided signal.interests.entities were invalid` for most types (Barry Lewis: only destinations worked). → Reported as “no audience-taste data” for those types and not retried; a creator with fewer than 10 scored entities gets no score.
9. **Dropped connections and 429s under load.** A Find creators run sends about 60 profile queries; a few sometimes fail with a network error or `429`, and an immediate retry often fails again. → Network errors wait 750 ms before the one retry; anything still failing is asked once more after the rest. Each Qloo step in the Agent Trace records its HTTP attempts.
10. **Descriptions come in many languages.** `/v2/insights` returns `properties.short_descriptions` as `[{ value, language }]` in no fixed order. → Only the `en` entry is shown.
11. **No YouTube links in Qloo.** People carry `properties.external` (Instagram, Twitter, IMDb) on `/search` results only, not on `/v2/insights` results. → The channel lookup goes through `/search` and accepts a channel only if its title is the person’s name or alias and it has 10,000+ subscribers (“@TatiWestbrook” is an empty channel with the right title).
12. **Category tags are Wikipedia categories.** `technology_youtubers`, `gaming_youtubers`, `beauty_makeup_youtubers` and others work as `filter.tags`, but coverage is uneven, and only two people are tagged `taiwanese_youtubers`. Several tags in a comma list are OR, not AND.

## What is deliberately not done

- No guessed entity IDs: IDs are stored exactly as Qloo returns them.
- No LLM-generated taste signals: an LLM-proposed name counts only after Qloo confirms it.
- No score without evidence: fewer than 3 creator entities, or no brand side confirmed by Qloo, returns `insufficient-data`.
- No free-text tags: only tag IDs returned by `/v2/tags` are sent as signal.
