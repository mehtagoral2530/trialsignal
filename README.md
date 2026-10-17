# TrialSignal

TrialSignal explains medical studies in plain English. It gets live updates from ClinicalTrials.gov.

TrialSignal is a learning tool built on the public record. It does not decide who can join a study, which treatment suits someone, or which treatment is better.

> All data must be verified against the official IRB-approved protocol and investigator brochure before clinical application.

## Hosting: free, GitHub only

What is deployed needs nothing but this GitHub repo: zero accounts, zero secrets.

- **GitHub Pages** serves the site.
- **Your browser** reads ClinicalTrials.gov directly, so search and study pages are live. Live updates work like this:
  - While a tab is visible, it asks `GET /api/v2/version` about every 5 minutes (and when you come back to the tab, at most once a minute). That is a tiny request, about 12 an hour per open tab.
  - Your saved studies are refreshed only when the registry's `dataTimestamp` moves, which is about once per weekday. They go in one batched request per 100 ids.
  - Answers are cached in localStorage for 24 hours, and only while the `dataTimestamp` is unchanged.
  - Failed checks back off (exponential, full jitter, from 15 seconds up to 1 hour). After 3 failed checks in a row, the site shows the saved copy.
- **A GitHub Action** refreshes a saved copy hourly. It reads `/version` first and stops there when the registry hasn't moved. If the registry moved but none of the tracked studies did, it commits only the new timestamp and deploys nothing. If your browser can't reach ClinicalTrials.gov, the site shows that copy instead. The same job keeps the saved copy of the news page (`site/data/news.json`), with its own cheap check. That step stops after 4 minutes and can never fail or hold up the job.

- **Live news.** The *What's new* page is built from public sources when you open it, with no key or account. Each story names the sources behind it.
  - *Results posted* and *stopped, paused or cancelled* studies come from ClinicalTrials.gov, the primary record. For results, PubMed and Europe PMC are each searched for a journal article about the study. We say what we found, never that an article reports those results. A study with no article found is labelled "Results posted, no article found", and the card says only that our search found none and that searches can miss articles.
  - *FDA approvals* come from openFDA (Drugs@FDA) and are shown only when a second source agrees: RxNorm, or a DailyMed label (the hourly Action asks DailyMed, because DailyMed can't be called from a browser). Anything only one source knows about is left out until a second one catches up.
  - If a source is down, the others carry on, and the missing part comes from the saved copy (`site/data/news.json`). The hand-picked stories stay, labelled "Picked by hand". The line at the top names only the sources that really answered. All answers are cached for 24 hours. The design and rate limits are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Publish (one time, about 5 minutes)

1. Unzip, then run:
   ```bash
   bash trialsignal/publish.sh
   ```
   This pushes the code as a new `main` branch. Your other branches are not touched. GitHub may ask you to sign in.

   No terminal? Install [GitHub Desktop](https://desktop.github.com), create a `main` branch, copy these files in, then commit and push.
2. On github.com, open **Settings → General → Default branch** and choose **main**.
3. Open **Settings → Pages → Source** and choose **GitHub Actions**.
4. Open **Actions → Deploy site to GitHub Pages → Run workflow**.

The site will be at `https://<you>.github.io/<repo>/`. From then on, every push to `main` redeploys it, and the snapshot runs on its own.

### Optional, not deployed: always-on live API (still free)

Nothing in `worker/` is deployed, and the site doesn't need it. The site uses the Worker only if the `TS_API_BASE` variable is set when the site is built. Without it, the site runs browser-direct, as described above, and no Worker, Redis or Workers AI is involved.

The upgrade adds a Cloudflare Worker and an Upstash Redis database. With them:

- studies are watched even while nobody has the site open
- there is a server-side change feed
- results are cached in Redis for 24 hours
- search becomes hybrid, with an AI reranker

The design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

1. Create a free database at [upstash.com](https://upstash.com) and copy its **REST URL** and **REST token**.
2. Create a free Cloudflare account. Note your **Account ID**, then make an **API token** from the "Edit Cloudflare Workers" template.
3. In GitHub, open **Settings → Secrets and variables → Actions** and add these secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - optional: `GH_DISPATCH_TOKEN`, a fine-grained token with Contents read/write on this repo

   Then add these variables:
   - `PAGES_ORIGIN` = `https://<you>.github.io`
   - `TS_API_BASE` = `https://trialsignal-api.<subdomain>.workers.dev`
4. Run **Actions → Deploy API worker**. It deploys, smoke-tests, and rolls back if the test fails. Then run **Deploy site to GitHub Pages** again. The site switches to the API on its own, and falls back to direct mode if the API is down.

To skip Workers AI, delete the `[ai]` block in `worker/wrangler.toml`.

## Run it locally

You need Node 20+. Redis is optional but needed for the integration tests.

```bash
npm run build                        # builds site/ (snapshot mode)
npx serve site                       # open http://localhost:3000

# Tests: they use REDIS_URL, or start a local redis-server if one is installed
npm test

# Browser tests (need Playwright + Chromium)
node test/e2e/pages-only.mjs         # GitHub-only setup
node test/e2e/run.mjs                # with the Worker + Redis

# Worker against your own Upstash database
cd worker && printf 'UPSTASH_REDIS_REST_URL=...\nUPSTASH_REDIS_REST_TOKEN=...\n' > .dev.vars
npx wrangler@3 dev                    # http://localhost:8787/v1/health
TS_API_BASE=http://localhost:8787 node ../scripts/build-site.mjs
```

## Repository map

```
app/        front-end source (shell.html, core.js, views.js, live.js, …)
shared/     code used by both the Worker and the scripts: hashing, BM25, RRF, curated IDs
worker/     optional, not deployed: Cloudflare Worker API, including the Redis Lua scripts
scripts/    build-site.mjs, snapshot.mjs, seed-index.mjs
site/       build output plus data/ (committed by the snapshot job) and fonts
site/portfolio/  Goral Bhatt's portfolio page, hand-written (served at /portfolio/)
test/       unit, real-Redis integration and end-to-end tests
.github/    CI, Pages deploy, Worker deploy, snapshot, health
docs/       ARCHITECTURE.md
```

## API (optional Worker, not deployed)

| Endpoint | Notes |
|---|---|
| `GET /v1/health` | Reports `{ ok, version, redis, ai }` |
| `GET /v1/search?q=` | Hybrid search (BM25 + registry + optional dense, fused with RRF), then reranked; cached 24h |
| `GET /v1/studies/{NCT}` | Returns an ETag; responds 304 when unchanged |
| `GET /v1/changes?since=epoch.seq` | Change feed with ETag/304. Returns `410` when the cursor's epoch no longer exists. |
| `GET /v1/state?ids=` | Current tracked state for up to 50 studies |
| `POST /v1/watch` | Body `{ids:[…]}`. Requires an `Idempotency-Key` header. |

## Credits

The data comes from [ClinicalTrials.gov](https://clinicaltrials.gov) (U.S. National Library of Medicine). The font is Figtree (SIL OFL). TrialSignal is an independent portfolio project and is not affiliated with NLM, the FDA or any study sponsor.
