# TrialSignal architecture

TrialSignal is a static site with a small live API beside it. Every part runs on a free tier, and if any part fails, the site falls back to something simpler that still works.

```
 Browser (GitHub Pages: static HTML/CSS/JS)
   │  1. GET /v1/changes?since=epoch.seq   every ~5 min, visible tab only, ETag/304
   │  2. GET /v1/search, /v1/studies/{id}, /v1/state, POST /v1/watch
   │  3. fallback: GET /data/snapshot.json + changes.json (same origin)
   ▼
 Cloudflare Worker  (trialsignal-api, zero dependencies)
   ├─ edge cache (caches.default, short s-maxage)
   ├─ Upstash Redis over REST: cache (24h TTL), state, change feed, locks, idempotency keys
   ├─ Workers AI (optional): bge-small embeddings + bge-reranker-base
   └─ ClinicalTrials.gov API v2 (rate-limited to 30/min, circuit breaker)
        ▲
 Cron */15 min: poll curated + watched studies → Lua CAS → change feed
 Cron daily:    prune old watches; ask GitHub to rebuild the snapshot if it is stale

 GitHub Actions
   ci.yml            tests against a real Redis service, site build, Worker dry-run
   deploy-pages.yml  build and publish site/
   deploy-worker.yml test → deploy → sync secrets → smoke test → roll back on failure
   snapshot.yml      every 3h: fetch, diff, commit site/data only if it changed, redeploy
   health.yml        daily: API + snapshot pipeline check, opens one issue on failure
```

## Why this shape

- **The static host can't poll anything by itself.** GitHub Pages only serves files, so "real time" needs a scheduler and a place to keep state. Cloudflare Workers gives us both on its free plan (cron triggers and fetch), and Upstash gives us Redis over HTTPS, which a Worker can call.
- **The registry is the source of truth.** Redis is a cache plus a derived change log, and everything in it can be rebuilt from ClinicalTrials.gov. That keeps durability needs modest (see ACID below).
- **The page has to degrade gracefully.**
  - If the Worker is up, the page is live.
  - If Redis is down, search and study pages still work but the change feed doesn't.
  - If the Worker is down, the page uses the 3-hourly snapshot.
  - If everything is down, the bundled curated data still renders.

## Redis key schema (`ts:v1:` prefix)

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `raw:{nct}:{hash}` | string | 24h − jitter | Full study JSON, content-addressed |
| `q:{sha256(normalized query)}` | string | 24h − jitter | Search results; fresh for 1h, then stale-while-revalidate |
| `study:{nct}` | string | none | Tracked-state baseline `{hash, lup, status, dates, enrollment}` |
| `seq` | int | none | Monotonic change-feed counter |
| `epoch` | string | none | Random ID set once; if Redis is wiped, the new epoch invalidates old cursors |
| `feed` | zset | none, capped at 5000 by rank | Change entries scored by `seq` |
| `watch` | zset | pruned after 30 days | Studies visitors saved, scored by last request time |
| `run:{slot}` | string | 1h | Cron de-duplication marker per 15-minute slot |
| `lock:poll` | string | 240s lease | Single poller at a time; released with compare-and-delete |
| `lock:q:{h}` | string | 30s | Stampede guard for refreshing a stale query |
| `idem:{key}` | string | 60s while pending, 24h once done | Stored response for `POST /v1/watch` |
| `rl:ct:{minute}` | int | 120s | Budget for ClinicalTrials.gov calls |
| `cb:ct`, `cb:fails` | string, int | short | Circuit breaker |
| `ai:{day}` | int | 48h | Workers AI daily call budget (300) |

**About the 24h TTL.** Cached reads (raw study JSON and search results) expire after 24 hours minus up to 30 minutes of random jitter, so that entries written together do not all expire at once. State that the change feed depends on (`study:*`, `seq`, `epoch`, `feed`) has **no** TTL. If a baseline expired, the next poll would treat the study as new, and a real change could be missed.

## Idempotency

| Operation | How a repeat becomes a no-op |
|---|---|
| Cron fires twice, or overlaps itself | `SET run:{slot} NX EX 3600`, then a `lock:poll` lease with a random token, released by a Lua compare-and-delete |
| The same registry response is applied twice | Lua compare-and-set on the tracked-state hash; an equal hash means skip |
| An older response arrives after a newer one | Lua rejects it if its `LastUpdatePostDate` is older than the stored one (monotonic) |
| The browser retries `POST /v1/watch` | `Idempotency-Key` header. `SET idem:{k} pending NX EX 60` claims the key; a concurrent duplicate gets 409; a later duplicate replays the stored response with `Idempotent-Replayed: true` |
| The browser sees the same change twice | It keeps a cursor `epoch.seq` in localStorage; feed entries are keyed by `seq` |
| The snapshot job reruns | A content hash of the tracked state; when it is unchanged, nothing is written, committed or deployed |
| Caches refresh concurrently | A stampede lock per query; losers serve the stale value |

## ACID, honestly

Redis is not a relational database. This is what each property means here, and how it is achieved.

- **Atomicity.** Each batch of studies is applied by one Lua script (`worker/src/lua.js` `APPLY`). Redis runs the script without interleaving other commands. Redis does not roll a script back if it fails halfway, so the script **validates every input before its first write**. Bad input aborts the whole batch with nothing written, and a test covers this. `POST /v1/watch` writes the watch and its stored idempotent response in one `MULTI/EXEC`.
- **Consistency.** The script enforces the invariants:
  - `seq` only increases.
  - A feed entry exists only if the state changed.
  - State never moves backwards in `lastUpdate`.
  - The feed is trimmed by rank, never by time.
- **Isolation.** Scripts and `MULTI` blocks run serially, so concurrent pollers produce exactly one feed entry per real change. A test runs 8 concurrent appliers and checks this.
- **Durability.** This comes from Upstash's persistence. If Redis is lost anyway:
  1. A new `epoch` is created.
  2. Clients get `410 Gone` on their old cursor and resync from `/v1/state`.
  3. The first poll rebuilds baselines without emitting false "changes".

  The GitHub snapshot (`site/data/*.json`, committed to git) is a second, independent durable record.

## Live updates

1. **Server.** Every 15 minutes the Worker fetches the curated studies plus every study a visitor saved in the last 30 days. It uses `filter.ids` batches of 100 with a small `fields` list, then applies them through the Lua compare-and-set. Each real change appends `{seq, nct, fields, prev, state, at}` to the feed.
2. **Client** (`app/live.js`).
   - Calls `GET /v1/changes?since=<cursor>` about every 5 minutes (±20% jitter), only while the tab is visible.
   - Sends `If-None-Match`, so quiet periods cost a 304.
   - Backs off exponentially, with full jitter, up to 1 hour on errors.
   - A `410` triggers a resync.
   - Changes to saved studies show a toast and update the Saved drawer.
3. **Why polling and not WebSockets or SSE.** Registry data changes at most daily per study. A 5-minute poll with 304s is cheaper than holding connections open, works on the free tier, and survives proxies.

## Hybrid search with reranking

`GET /v1/search?q=` (`worker/src/search.js`):

1. **Normalize.** Lowercase, strip punctuation, apply a light stemmer, sort tokens, and append the filters. The result is hashed with SHA-256 to form the cache key, so "Heart Failure" and "failure heart" share one cache entry.
2. **Retrieve in parallel.**
   - **Lexical.** BM25 (k1=1.2, b=0.75; field weights: title 3, conditions 2, interventions 2, summary 1). It runs over the curated set plus about 120 recently updated studies from the snapshot's `index.json`. Top 50.
   - **Registry.** ClinicalTrials.gov `query.term`. Top 25.
   - **Dense (optional).** `bge-small-en-v1.5` embeddings of the query and the candidates, ranked by cosine similarity.
3. **Fuse.** Reciprocal Rank Fusion (k=60). It needs no score calibration across retrievers. An exact NCT ID match is pinned first.
4. **Rerank.** The top 30 go to the `bge-reranker-base` cross-encoder, with an 800ms timeout and a budget of 300 calls per day. If the reranker is unavailable, a heuristic reranker is used instead (exact phrase in the title, curated boost, recency).
5. **Cache.**
   - Results are stored for 24h. After 1h they are stale and get refreshed in the background under a lock.
   - Results from a degraded run (registry leg failed) are **not** cached, so a short outage doesn't stick for a day.

## Protecting ClinicalTrials.gov

- **Rate limit.** At most 30 requests per minute across all Worker instances, counted in Redis.
- **Circuit breaker.** Three 429 or 5xx responses within 120 seconds open the breaker. While it is open, search uses BM25 only and polling skips that run.
- **Batching.** Polling sends one request per 100 studies, never one per study.

## Failure modes

| Failure | What users see |
|---|---|
| ClinicalTrials.gov slow or down | Search answers from the local index, flagged as `degraded`; polling waits for the next slot |
| Redis down | Search and study pages still work. `/v1/changes` returns 503, and the client backs off and uses the snapshot |
| Worker down or over quota | The site switches to "saved copy" mode using `data/snapshot.json` |
| Redis wiped | New epoch; clients get 410, then resync; no false change alerts |
| Snapshot job fails | `health.yml` opens an issue; the Worker's daily cron re-dispatches it |
| GitHub pauses cron after 60 idle days | `health.yml` re-enables it, and the Worker's `repository_dispatch` still triggers it |

## Free-tier budget (estimates; check current limits)

| Service | Usage |
|---|---|
| Cloudflare Workers | 96 polls/day plus visitor traffic, against a 100k requests/day free allowance. Most of the time is spent waiting on network I/O; CPU per request is small but should be watched against the free-plan CPU limit. |
| Upstash Redis | About 10 commands per poll, about 1k/day. Edge caching (`s-maxage=60` on `/v1/changes`) means visitors who share a cursor are mostly served from cache. |
| Workers AI | Capped in code at 300 reranks per day. |
| GitHub Actions | Free for public repos. The snapshot job takes about 1 minute, 8 times a day. |

## CI/CD

```
push/PR ─► ci.yml (Redis service → tests → build → wrangler dry-run)
main    ─► deploy-pages.yml (app/site/shared/scripts changed)
main    ─► deploy-worker.yml (worker/shared changed): test → deploy → secrets → smoke → rollback
cron 3h ─► snapshot.yml → commit only on change → deploy-pages (workflow_call)
daily   ─► health.yml → re-enable cron, check API + snapshot age, open/update one issue
```

The deploy jobs use `concurrency` groups that never cancel a deploy in progress. Secrets live only in GitHub Actions secrets and Worker secrets, never in the repository or the static bundle.

## Testing

- `test/core.test.mjs`: hashing, normalization, BM25, RRF and reranking.
- `test/redis.test.mjs`: runs against **real Redis**, through an Upstash-compatible REST shim. It covers:
  - the Lua compare-and-set and replay idempotency
  - monotonic state and validate-before-write
  - cron de-duplication
  - `/v1/changes` ETag, 304 and 410
  - the 24h cache TTL
  - studies ETag
  - watch idempotency and 409
  - degraded modes
  - concurrent isolation
- `test/snapshot.test.mjs`: snapshot idempotency, and retry with backoff.
- `test/e2e/run.mjs`: Playwright run of the built site against a local Worker, Redis and a fake registry: search → open a study → save → cron detects a change → the browser feed poll shows it.
