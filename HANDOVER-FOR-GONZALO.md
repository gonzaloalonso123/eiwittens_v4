---
title: "GierigGroeien Scraper Upgrade — Handover for Gonzalo"
author: "Timo (via Claude)"
date: "2026-05-20"
---

# GierigGroeien Scraper Upgrade — Handover

**Date:** 2026-05-20
**Branch:** `scraper-upgrade-layer-0` (not yet pushed — see Deploy section)
**Status:** Code complete + Firestore data updated locally; Cloud Run deploy pending.

---

## TL;DR

We rebuilt the scraper architecture around **AI as source of truth, with monthly verification**. The daily Cloud Run scrape can stay broadly the same; the new pieces are:

- **Layer 0 (Free Extractor)** for structured-data sites — 253 products, zero AI calls, free.
- **Layer 2 / feed_awin** for MyProtein — 40 products via Awin feed, daily refresh, free + affiliate revenue.
- **Layer 3 / vision_only** new extraction method — 42 products that can't be parsed via XPath or HTML AI; daily scrape skips them and a new monthly verify job refreshes them via Claude vision.
- **Reactive AI fallback** in the daily pipeline now has a **counter + auto-promotion**: after 3 consecutive AI fallbacks, a product is auto-promoted to `vision_only` so we stop burning AI calls on inherently unstable sites.
- **`manual_lock=true`** is now the universal "I own this product's config" signal — verify-with-ai stamps metadata + warning only, never modifies scraper / scrape_enabled / extraction_method / price.

Concrete data changes today (2026-05-20):

- **56 silent drifts** corrected (XPath gave wrong prices on the live site for months; AI caught them).
- **121 stale prices** synchronized from `ai_verified_price` into `price`.
- **40 MyProtein** products migrated to the Awin feed.
- **92** previously-disabled products re-enabled after Timo's manual URL review.
- **5 unscrapable** products fixed via a new vision-click discovery flow.
- **15** products explicitly set to `manual_lock=true` to protect their corrected configurations.

**Not yet done (you):** deploy to Cloud Run, set secrets, schedule the new monthly verify job, rotate API keys.

---

## Honest assessment

| What is tested | What is not |
|---|---|
| All new code compiles (`tsc --noEmit` clean) | Cloud Run build and deploy with the new code |
| Local execution via `pnpm tsx` against Firestore admin SDK | Anthropic API rate limits at production scale |
| ~537 product verifications and ~600 Firestore writes during the bootstrap | The monthly verify-with-ai job running unattended on Cloud Run |
| Vision-click discovery on the hard cases (5 of 7 worked, 2 still stuck) | The new ExtractionMethod `vision_only` running through the daily pipeline's skip filter in production |
| `manual_lock=true` semantic protects 21 products | Whether broken-XPath products will hit the auto-promote threshold in practice |

**Known broken / unresolved:**

- 15 antibot/JS-rendered products (FAILED-REVIEW.md) — auto-fix exhausted; will need manual prices or stay disabled.
- 2 stuck products (STUCK.md) — variant-picker pages where vision discovery didn't find a working click target.
- API keys (ANTHROPIC_API_KEY, AWIN_FEED_MYPROTEIN_URL) live in `backend/.env` (gitignored, never pushed). They were used during local Claude work sessions. Best-practice hygiene says to rotate them at some point, but this is not a deploy-blocker — they have not been exposed publicly.
- Cloud Run job has been failing since approximately 2026-05-12 — root cause is suspected Chromium launch issues (`page.goto: navigating to "about:blank"` timeouts). This needs your eyes on Cloud Logging.

---

## Catalogue snapshot — before vs after today

| Metric | Before today | After today |
|---|---|---|
| Total products in Firestore | 889 | 889 |
| Visible (`enabled=true`) | 737 | 829 |
| Hidden (`enabled=false`) | 152 | 60 |
| In daily scrape (`scrape_enabled=true`) | 644 | 792 |
| Hard-priced (`scrape_enabled=false`) | 93 | 37 |
| On `feed_awin` | 0 | 40 |
| On `vision_only` | 0 | 42 |
| With `ai_verified_at` stamped | 0 | 454 |
| With `manual_lock=true` | 0 | 15 |

Pipeline-eligible (i.e. what `daily-scrape-runner` will iterate, after we deploy the new filter):

```
Layer 0  free_*           253  — JSON-LD / Shopify / OG / microdata, no AI
Layer 1  playwright       462  — XPath + reactive AI fallback with auto-promote
Layer 2  feed_awin         40  — MyProtein authoritative (skipped by daily scrape)
Layer 3  vision_only       42  — monthly only (skipped by daily scrape)
                          ───
                          792  — total enabled+scrapable
```

The daily scrape's effective workload (after Layer 2/3 filtering) is **715 products** instead of the previous 644 — a net +71 due to re-enabling.

---

## New layer architecture

### Daily scrape (unchanged orchestration, new filters)

In `backend/src/pipeline/index.ts` the eligible-product filter now excludes both `feed_awin` AND `vision_only`:

```ts
selected = selected.filter((product) => (
    product.extraction_method !== 'feed_awin'
    && product.extraction_method !== 'vision_only'
));
```

In `backend/src/scraper/index.ts` the per-product extraction logic now dispatches by `extraction_method`:

1. `feed_awin` → return the existing `product.price` (managed by Awin sync job, not scraped).
2. `free_*` → Layer 0 Free Extractor (JSON-LD / Shopify / OG / microdata).
3. Default `playwright` → existing executeActions path; on failure, AI fallback engages.

The AI fallback in `scrapeProductOnPage` now has a **counter** + **auto-promotion**:

```ts
const prevCount = product.consecutive_ai_fallbacks ?? 0;
const newCount = prevCount + 1;
if (newCount >= AI_FALLBACK_PROMOTION_THRESHOLD) {
    // After 3 consecutive AI fallbacks → site is unstable for XPath. Stop
    // burning AI calls daily; promote to vision_only and let monthly verify
    // take over.
    await updateProduct(product.id, {
        consecutive_ai_fallbacks: newCount,
        extraction_method: 'vision_only',
        warning: true,
    });
} else {
    await updateProduct(product.id, {
        scraper: fixedActions,
        consecutive_ai_fallbacks: newCount,
    });
}
```

When a daily scrape's XPath succeeds (no AI fallback engaged), the counter is reset to 0. This means a product needs to be broken 3 days in a row before it gets pushed to `vision_only`.

**`manual_lock=true`** is respected here too: a manually-locked product never has its `scraper[]` overwritten by the daily AI fallback (this was already in the code before today; we kept it).

### Monthly verify-with-ai (new)

Run by `backend/src/jobs/verify-with-ai.ts`. For each candidate product:

1. Open the URL in Playwright, dismiss cookie banner.
2. Run the existing scraper actions → `xpathPrice` (may be null if scraper fails or returns implausible value).
3. Open a fresh page and run `anthropicExtractPrice` (HTML AI) → `aiPrice`.
4. If HTML AI fails or returns implausible value → run `anthropicExtractPriceFromImage` (vision fallback) → `visionPrice`.
5. Compute verdict:
   - `agree` (XPath and AI within 1%): stamp `ai_verified_at`, `ai_verified_price`, sync `price`.
   - `disagree` (>1% diff): AI wins — replace Select action in scraper, sync `price`, increment `ai_disagreement_count`, set `warning=true`.
   - `ai_only` (XPath failed, AI ok): replace selector OR re-enable scrape_enabled, sync `price`.
   - `vision_only_ok` (HTML AI failed, vision ok): promote to `extraction_method='vision_only'`, sync `price`.
   - `xpath_only` (XPath ok, AI failed): no writes (XPath remains; we couldn't validate).
   - `both_failed` (everything failed): no writes; product needs manual review.

`manual_lock=true` short-circuits all selector/state-changing actions — only metadata + warning are written.

### Vision-click discovery (new — for the truly hard cases)

`backend/src/jobs/discover-variant-clicks.ts` is the most experimental piece. It handles products where the page has a size picker and the variant we want isn't the page default. The flow is:

1. Open page, dismiss cookies.
2. Screenshot.
3. Ask Claude vision: "What button text should I click to display the {amount} variant?"
4. Click that text via Playwright.
5. Re-screenshot.
6. Ask Claude vision again for the displayed price.
7. Save scraper with `[ClickByText(found_text), Wait(1500)]` + set extraction_method to `vision_only` + manual_lock.

Result on the 7 we tried: 5 worked (3 Zumub variants that were already-displayed; BodySupplies; Natuurlijk Natuurlijk 6kg). 2 still stuck (VanBeekum 15kg — click hit a dropdown that didn't switch state; XXLNutrition 4kg — vision found the right button text but Playwright couldn't locate it).

---

## Data model changes

In `packages/types/src/product.ts`:

```ts
export type ExtractionMethod =
    | 'playwright'        // (default) XPath/Click/Select + AI fallback
    | 'free_jsonld'
    | 'free_shopify'
    | 'free_og'
    | 'free_microdata'
    | 'feed_awin'
    | 'vision_only';      // NEW — daily scrape skips; monthly verify-with-ai refreshes via vision

export interface Product {
    // ... existing fields unchanged ...

    /** Last time the monthly AI verification confirmed (or repaired) this product's price selector. */
    ai_verified_at?: Date | { seconds: number; nanoseconds: number };

    /** Price AI extracted at the last verification — used for drift detection. */
    ai_verified_price?: number;

    /** How many times AI has disagreed with the XPath. High values signal an unstable shop layout. */
    ai_disagreement_count?: number;

    /** Consecutive daily scrapes that fell back to AI. Resets to 0 on a successful XPath extract.
     *  Auto-promote threshold is 3 — at which point extraction_method becomes vision_only. */
    consecutive_ai_fallbacks?: number;
}
```

No fields were removed. No existing field's semantics changed except for `manual_lock` (see below).

### `manual_lock` semantics — important behavior change

Before today: `manual_lock=true` only protected against the *disagreement* branch of the daily AI fallback.

After today: `manual_lock=true` is the universal "user owns this product's config" signal. Both the daily pipeline and the monthly verify job respect it:

- `scraper[]` — never modified
- `scrape_enabled` — never modified
- `extraction_method` — never modified
- `price` — never modified
- Verification metadata (`ai_verified_at`, `ai_verified_price`, `ai_disagreement_count`, `warning`) — may still be written so the dashboard can surface drift.

Workflow for Timo (or any future operator): to lock a product into a manually-managed state, set both `scrape_enabled=false` and `manual_lock=true` in the dashboard. Then manually set the `price` field if needed. The system will leave that config alone.

---

## Code changes — file-by-file

### Modified files (existing code we changed)

| File | What changed |
|---|---|
| `packages/types/src/product.ts` | Added 4 new fields and `vision_only` extraction method (see Data model above). |
| `backend/src/scraper/extractor-anthropic.ts` | Added 429/5xx retry+backoff, vision fallback (`anthropicExtractPriceFromImage`), vision-click discovery (`anthropicDiscoverVariantClick`). |
| `backend/src/scraper/index.ts` | Added counter + auto-promote-to-vision_only logic in the AI fallback persist path. Added reset-on-success at the end of `scrapeProductOnPage`. |
| `backend/src/pipeline/index.ts` | Daily-scrape filter now excludes both `feed_awin` and `vision_only`. |
| `backend/src/jobs/awin-feed-import.ts` | Fixed variant-mismatch bug (introduced `variation_exact` strategy, falls back to old `merchant_product_id`/`url_substring`). Added `--safe-only` flag (default ON) to only persist variation_exact matches. Now includes `scrape_enabled=false` MyProtein products in matching (was excluding them). Sets `scrape_enabled=true` on apply. |

### New job scripts (all in `backend/src/jobs/`)

| File | Purpose |
|---|---|
| `verify-with-ai.ts` | **Core new job.** Monthly verification: XPath + HTML AI + vision parallel, write decisions per `manual_lock` and verdict matrix. |
| `inventory-products.ts` | Catalogue snapshot tool. Lists hard-priced, disabled, no-scraper products by store. |
| `inspect-product-scrapers.ts` | Dumps scraper config for a list of product IDs. |
| `inspect-myprotein.ts` / `inspect-myprotein-status.ts` | MyProtein-specific debug views (URL collisions, variant param presence). |
| `diagnose-scraper.ts` | Reads recent `scrape_runs` from Firestore to diagnose Cloud Run health. |
| `bulk-toggle.ts` | Generic batch enable/disable utility (`--field enabled --value true --ids id1,id2`). |
| `apply-disabled-review.ts` | Parser for the markdown review file format we use. Reads "is nog goed" / "bestaat niet meer" / URLs / amount notes and applies. |
| `dump-failed-products.ts` | Generates FAILED-REVIEW.md for products where all extraction methods failed. |
| `dump-suspicious-syncs.ts` | Generates SPOTCHECK.md flagging price changes that look like AI hallucinations. |
| `fix-suspicious-syncs.ts` | Hardcoded fix list — applied today's specific corrections to 16 products from spot-check. Not reusable as-is. |
| `sync-prices-from-verified.ts` | One-shot: for products with fresh `ai_verified_price`, copy it into the `price` field. Includes safety net for per-unit-price hallucinations. |
| `refresh-prices-for-ids.ts` | Runs the production scrape pipeline locally on a list of IDs and writes the result. Useful after editing scrapers manually. |
| `discover-variant-clicks.ts` | Vision-driven discovery of variant-picker click targets for hard-to-scrape products. |

### Reports / review files generated for human review

- `SPOTCHECK.md` — 18 price changes flagged as suspicious; most have already been corrected.
- `STUCK.md` — 2 products still requiring manual dashboard fix.
- `FAILED-REVIEW.md` — 15 antibot products that may need hard prices.
- `DISABLED-REVIEW.md` — 142 disabled products (already processed by Timo).
- `verify-reports/*.md` — Auto-generated per verify-with-ai run; useful for debugging.

---

## Deploy steps (for you)

### 1. Pull the branch

```bash
git checkout scraper-upgrade-layer-0
git pull origin scraper-upgrade-layer-0    # if Timo pushed
# OR if not pushed yet: pull the patch from Timo directly
```

Note from Timo: the branch has **22 untracked job scripts + 8 modified files** as of 2026-05-20 evening, not yet committed. We need to coordinate the commit — see "Outstanding work" below.

### 2. Install + build

```bash
cd current-system/packages/types
pnpm tsc

cd ../../backend
pnpm install
pnpm build
```

Both should compile clean. We verified `tsc --noEmit` is happy.

### 3. Set Cloud Run secrets

Set these two in Cloud Run secrets for the relevant services (backend will read them from `process.env`):

- `ANTHROPIC_API_KEY` — used by the AI fallback in the daily scrape AND by the monthly verify-with-ai job
- `AWIN_FEED_MYPROTEIN_URL` — used by the awin-sync-runner job

The keys currently live in Timo's local `backend/.env` (gitignored, not in the repo). You can copy them from there, or Timo can share them out-of-band. Optional best-practice: rotate before setting in Cloud Run if you prefer fresh keys.

### 4. Deploy the backend service

```bash
pnpm deploy:backend
# OR equivalent — see deploy.sh
```

After deploy, smoke test the daily scrape on a single product:

```bash
pnpm run-scrape-job
# OR manually trigger one product:
gcloud run jobs execute daily-scrape-runner --region europe-west4 --args="--product-id=<id>"
```

### 5. Investigate the existing Cloud Run scrape failure

Independent of our changes, the daily scrape has been failing since ~2026-05-12 with `page.goto: navigating to "about:blank"` timeouts. We confirmed this by reading `scrape_runs` collection (script: `diagnose-scraper.ts`). This is almost certainly a Chromium-launch issue in the Cloud Run container. Suspects:

- Out of memory on the Cloud Run container
- Missing system deps after a base-image update
- Chromium binary mismatch vs the Playwright npm version

Check Cloud Logging:

```bash
pnpm cloud:scrape:logs
```

This is the highest-priority deploy-blocker. Without fixing it, all the new code is theoretical.

### 6. Create the monthly verify-with-ai Cloud Run job

This is a brand-new Cloud Run Job, similar to `daily-scrape-runner`. Suggested config:

- **Job name:** `monthly-verify-with-ai-runner`
- **Image:** same backend image (the job script lives in `backend/dist/jobs/verify-with-ai.js`)
- **Entrypoint:** `node dist/jobs/verify-with-ai.js -- --apply`
- **Memory:** 4Gi (Playwright + Anthropic SDK)
- **Timeout:** 4 hours (verifying ~500 products takes ~75 min at concurrency=2; allow headroom)
- **Schedule:** monthly, e.g. first day of month at 04:00 UTC

Add a Cloud Scheduler trigger.

Optional but recommended: when scheduling, pass `--concurrency 3` and `--stale-days 28` flags so it skips any products freshly verified.

### 7. Adjust daily cron from 4×/day → 1×/day

Currently the daily scrape runs at 04:00 UTC × 4 = every 6 hours. Bump it back to once a day. Timo asked specifically for this — it saves ~75% in Cloud Run cost, and the only product that justified 4× was MyProtein (now on feed).

### 8. Awin feed-import job

We added `--apply` mode and `--safe-only` flag to `awin-feed-import.ts`. To keep MyProtein prices fresh daily, you'll want this on its own Cloud Run Job + Scheduler:

- **Job name:** `awin-sync-runner`
- **Entrypoint:** `node dist/jobs/awin-feed-import.js --apply`
- **Schedule:** daily, ~30 minutes BEFORE the daily-scrape-runner (so the feed prices are fresh when the daily scrape runs and skips them).

The npm script `start:awin-sync` is already wired up in `backend/package.json`.

---

## Operations — how to run things post-deploy

### Monthly verify-with-ai

The Cloud Scheduler trigger handles this. But you can also run manually:

```bash
# Dry-run on all candidates
pnpm tsx src/jobs/verify-with-ai.ts

# Apply on all candidates
pnpm tsx src/jobs/verify-with-ai.ts -- --apply

# Apply on one store
pnpm tsx src/jobs/verify-with-ai.ts --store "Zumub" -- --apply

# Apply on specific product IDs
pnpm tsx src/jobs/verify-with-ai.ts --product-ids id1,id2 -- --apply

# Skip products verified within last N days
pnpm tsx src/jobs/verify-with-ai.ts --stale-days 28 -- --apply
```

A markdown report lands in `current-system/verify-reports/` per run.

### Diagnose a broken daily scrape

```bash
pnpm tsx src/jobs/diagnose-scraper.ts
```

Prints recent `scrape_runs` documents with status + per-item error samples.

### Catalogue inventory

```bash
pnpm tsx src/jobs/inventory-products.ts
pnpm tsx src/jobs/inventory-products.ts --list-hard-priced
pnpm tsx src/jobs/inventory-products.ts --list-disabled
```

### Bulk fix-ups

```bash
pnpm tsx src/jobs/bulk-toggle.ts --field manual_lock --value true --ids id1,id2 --apply
pnpm tsx src/jobs/sync-prices-from-verified.ts -- --apply
```

---

## Outstanding work / known limitations

### Blocked on this deploy

1. **Branch not committed.** Timo (or you) will need to commit:
   - 8 modified files
   - 22 new job scripts in `backend/src/jobs/`
   - `verify-reports/` directory (should add to `.gitignore` probably)
2. **Cloud Run scrape failure** — pre-existing (since ~2026-05-12), blocks everything daily-related. Highest priority.
3. **Optional: API key rotation** — not a blocker; the keys are gitignored and have not been exposed publicly. Rotate if you prefer fresh keys.

### Manual review (Timo can do these)

1. **STUCK.md** — 2 products where vision-click discovery failed (VanBeekum 15kg, XXLNutrition 4kg).
2. **FAILED-REVIEW.md** — 15 antibot products that couldn't be auto-fixed.
3. **SPOTCHECK.md** — 18 price changes flagged as suspicious; partially auto-corrected, leftover ~10 may need a glance.

### Known gaps in the new architecture

- **`xpath_only` verdicts don't write `ai_verified_at`** — when XPath works but AI fails, we have no proof the XPath is right. These products won't auto-promote and won't be flagged for drift. Acceptable for now; can be improved later by treating a `xpath_only` verdict as "low-confidence agree" and stamping `ai_verified_at` with a `low_confidence` flag.
- **Vision-click discovery has known false positives** — VanBeekum 15kg passed the click but the page didn't actually switch variant. The script needs a post-click verification step that re-checks "is the displayed variant what we asked for?" before accepting the price.
- **Awin feed `merchant_product_id` fallback can mis-match variants** — protected by the `--safe-only` flag (default ON), which only applies `variation_exact` matches. The 17 unsafe MyProtein products are intentionally left on `playwright`/`vision_only`.
- **Per-unit-price hallucination safety net is narrow** — `sync-prices-from-verified.ts` blocks syncs where new price <€3 AND live price >€5 (catches Zumub-style €/gram bugs). Doesn't catch wrong-variant cases for large-pack products.

### Cost estimate going forward

- Daily Cloud Run: same as today (~€20-40/month) once it's healthy.
- Monthly verify-with-ai: ~€5/month at the regular Anthropic API price. Drops to ~€2.50/month if you switch to Anthropic's Batch API (50% discount, 24h SLA which is fine for monthly).
- Reactive AI fallback during the daily scrape: very low (only fires when XPath fails); estimate <€1/month.
- Vision discovery: only used during one-off fix-ups; negligible recurring cost.

---

## What we changed in Firestore today (audit trail)

For Gonzalo's reference, here is the rough breakdown of writes made by this session against `eiwittens` Firestore:

| Operation | Writes | Notes |
|---|---|---|
| Initial test batch on 20 broken-XPath products | 19 | 1 skipped (Power Supplements 15kg, dead URL) |
| MyProtein verify-with-ai (31 products) | 31 | 30 succeeded, 1 dead URL |
| Disabled review apply | 82 | re-enabled + URL updates |
| Awin --apply (variation_exact, --safe-only) | 40 | MyProtein → feed_awin |
| 404-product bootstrap verify | 404 | 253 agree, 55 disagree, 33 ai_only, 9 vision_only, 34 xpath_only, 20 both_failed |
| 82 newly-enabled bootstrap verify | 82 | re_enable + override_selector + vision_only |
| sync-prices-from-verified | 121 | propagate `ai_verified_price` → `price` |
| fix-suspicious-syncs (manual list) | 16 | scrapers restored + manual_lock |
| refresh-prices-for-ids (apply) | 9 | post-fix price refresh from local scrape |
| discover-variant-clicks (apply) | 5 | hard-case products to vision_only |
| Bulk re-enable of 10 disabled MyProtein | 10 | enabled=true only |

Total Firestore writes attributable to this session: **~820**. Zero errors reported during apply.

---

## Contact

- **Timo** — owner of the catalogue + product decisions.
- **Claude session log** — Timo has the full transcript if you want to see specific decisions or alternate paths considered.
- **Memory** — Timo's persistent Claude memory now includes notes on:
  - `gg-firebase-credentials` — service account location
  - `gg-variant-pickers` — pattern for variant-aware scrapers
  - `gg-manual-lock-semantics` — universal lock semantics

If you want to talk through the architecture or any specific job script, Timo can re-engage Claude in the same project and we'll have all this context loaded again.
