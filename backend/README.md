# Backend

## Local scrape testing

Create `backend/.env` from `backend/.env.example`, then run from the repository root:

```sh
pnpm scrape:local
```

The default local scrape is a dry run. It scrapes products and prints prices, but does not update product prices, create scrape-run records, send alert emails, or persist AI selector fixes.

Useful variants:

```sh
pnpm scrape:local -- --limit 5
pnpm scrape:local -- --product-id PRODUCT_ID
pnpm scrape:local -- --persist
```

Use `--persist` only when you want the same behavior as the Cloud Run scrape job from your local machine.

## Product data repair

If products still have the legacy `ammount` field or an `amount` stored as a string, run the amount repair migration first:

```sh
DRY_RUN=true pnpm migrate:repair-amount
pnpm migrate:repair-amount
```

This migration copies a valid legacy `ammount` into `amount` when needed, normalizes numeric string amounts, removes `ammount`, recalculates warning flags, and rebuilds computed price fields such as `price_for_element_gram`, `price_per_dose`, and calorie prices.

If a bad scrape left products with stale warnings or invalid prices, preview a repair first:

```sh
pnpm repair:products
```

Then apply it:

```sh
pnpm repair:products -- --write
```

The repair command targets products with `warning=true` or invalid prices. If a product has an invalid current price, it tries to restore the newest valid price from recent `scrape_runs` item baselines/results. It also recalculates computed price fields and removes stale computed fields that no longer apply.

To recompute every product that already has a valid price:

```sh
pnpm repair:products -- --all --write
```

## Cloud Run scrape debugging

Inspect the deployed job and recent logs:

```sh
pnpm cloud:scrape:describe
pnpm cloud:scrape:logs
```

For a smaller Cloud Run scrape, temporarily set debug filters on the job, run it, then remove them:

```sh
gcloud run jobs update daily-scrape-runner \
	--region europe-west4 \
	--project eiwittens \
	--update-env-vars SCRAPE_CONCURRENCY=1,SCRAPE_LIMIT=5

gcloud run jobs execute daily-scrape-runner \
	--region europe-west4 \
	--project eiwittens \
	--wait

gcloud run jobs update daily-scrape-runner \
	--region europe-west4 \
	--project eiwittens \
	--remove-env-vars SCRAPE_LIMIT,SCRAPE_PRODUCT_ID

gcloud run jobs update daily-scrape-runner \
	--region europe-west4 \
	--project eiwittens \
	--update-env-vars SCRAPE_CONCURRENCY=3
```

Use `SCRAPE_PRODUCT_ID=firestore-product-id` instead of `SCRAPE_LIMIT` when debugging one specific product. Invalid scraped prices are treated as failed scrape items, so a debug run should not overwrite a product with `0` anymore.