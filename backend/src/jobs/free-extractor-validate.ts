// Validate the Free Extractor against ALL products in a list of trusted stores.
// Catches silent-wrong-prices on GG side and confirms which products are
// safe to switch to Layer 0 (free extraction).
//
// Run with:
//   pnpm tsx src/jobs/free-extractor-validate.ts -- --concurrency 10
//
// Stores to validate are hardcoded below based on Tier A audit findings.

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFreePrice, NoFreeExtractionAvailable } from '../scraper/free-extractor.js';
import { createBrowser } from '../scraper/driver.js';
import type { Browser } from 'playwright';

const BACKEND_API = 'https://eiwittens-backend-16129604687.europe-west4.run.app';
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'free-extractor-reports');

// Tier A stores from capability audit (drift 0%, free method works perfectly).
// We validate ALL products in these stores to find silent-wrong-prices.
const TIER_A_STORES = new Set([
    'Bulk', 'Body&Fit', 'BodyLab', 'ESN', 'De Gezonde Wereld', '17Nutrition',
    'Mattisson', 'Power Supplements', 'Purasana', 'C4', 'GymQueen',
    'VanBeekumSpecerijen', 'YavaLabs', 'BioTechUSA', 'ScitecNutrition', 'bodyworld',
    'RebuildNutrition', 'Etos', 'Biotics', 'Jarrow Formulas', 'Amix',
    'Fitshape', 'Nova Vitae', 'Sportvoedingmaken',
    // Tier B — known drift but free method correct, GG outdated:
    'UPFRONT', 'BulkSupplements', 'Woele', 'VitaKruid',
    // Tier B special — Kosso shopify is RIGHT, GG wrong:
    'KossoNutrition',
]);

interface GgProduct {
    id: string;
    name: string;
    store: string;
    url: string;
    price: number;
    amount?: number;
    type: string;
    enabled: boolean;
    scrape_enabled: boolean;
    out_of_stock: boolean;
}

interface ValidationResult {
    productId: string;
    name: string;
    store: string;
    url: string;
    type: string;
    gg_price: number;

    free_price?: number;
    free_method?: string;
    free_currency?: string;
    free_in_stock?: boolean;
    free_fetch_method?: string;
    free_candidates?: Record<string, { price: number; in_stock?: boolean }>;
    free_error?: string;

    drift_pct?: number;
    verdict: 'agree' | 'gg_outdated' | 'free_wrong' | 'free_failed' | 'agree_oos';
}

const AGREE_THRESHOLD = 5; // <5% diff = agree
const OUTDATED_THRESHOLD = 50; // 5-50% diff = GG outdated, 50%+ = suspicious

async function fetchTierAProducts(): Promise<GgProduct[]> {
    const res = await fetch(`${BACKEND_API}/products?type=MINIMAL`);
    const all = await res.json() as GgProduct[];
    return all.filter((p) =>
        TIER_A_STORES.has(p.store)
        && p.enabled
        && p.scrape_enabled
        && !p.out_of_stock
        && p.price > 0,
    );
}

async function validateOne(product: GgProduct, browser: Browser): Promise<ValidationResult> {
    const result: ValidationResult = {
        productId: product.id,
        name: product.name,
        store: product.store,
        url: product.url,
        type: product.type,
        gg_price: product.price,
        verdict: 'free_failed',
    };

    try {
        const free = await extractFreePrice(product.url, {
            playwrightBrowser: browser,
            amountGrams: product.amount,
        });
        result.free_price = free.price;
        result.free_method = free.method;
        result.free_currency = free.currency;
        result.free_in_stock = free.in_stock;
        result.free_fetch_method = free.fetch_method;
        result.free_candidates = free.all_candidates;

        const diff = Math.abs(free.price - product.price);
        const pct = (diff / Math.max(free.price, product.price)) * 100;
        result.drift_pct = pct;

        if (pct < AGREE_THRESHOLD) {
            result.verdict = free.in_stock === false ? 'agree_oos' : 'agree';
        } else if (pct < OUTDATED_THRESHOLD) {
            result.verdict = 'gg_outdated';
        } else {
            result.verdict = 'free_wrong';
        }
    } catch (err) {
        if (err instanceof NoFreeExtractionAvailable) {
            result.free_error = err.reasons.join('; ');
        } else {
            result.free_error = (err as Error).message.slice(0, 200);
        }
    }

    return result;
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, idx: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (true) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await worker(items[i], i);
        }
    }));
    return results;
}

function summarize(results: ValidationResult[]): string {
    const lines: string[] = [];
    lines.push('# Free Extractor Validation Report');
    lines.push('');
    lines.push(`*Generated: ${new Date().toISOString()}*`);
    lines.push(`*Tier A stores: ${TIER_A_STORES.size} | Total products tested: ${results.length}*`);
    lines.push('');

    const counts: Record<string, number> = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;

    lines.push('## Verdict counts');
    lines.push('');
    lines.push('| Verdict | Count | % |');
    lines.push('|---|---|---|');
    for (const [v, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        lines.push(`| \`${v}\` | ${c} | ${((c / results.length) * 100).toFixed(1)}% |`);
    }
    lines.push('');
    lines.push('**Verdicts:**');
    lines.push(`- \`agree\` — Free price within ${AGREE_THRESHOLD}% of GG price. Safe to switch.`);
    lines.push('- `agree_oos` — Free price agrees but item is out-of-stock per feed.');
    lines.push(`- \`gg_outdated\` — Free price differs ${AGREE_THRESHOLD}-${OUTDATED_THRESHOLD}% from GG. Most likely: GG\'s scraped price is stale. **Free price wins after switch.**`);
    lines.push(`- \`free_wrong\` — Free price differs ≥${OUTDATED_THRESHOLD}% from GG. Investigate manually — could be free method picking wrong variant.`);
    lines.push('- `free_failed` — Free extractor could not find a price. Need to keep Playwright fallback.');
    lines.push('');

    // Per-store summary
    const byStore = new Map<string, ValidationResult[]>();
    for (const r of results) {
        const arr = byStore.get(r.store) ?? [];
        arr.push(r);
        byStore.set(r.store, arr);
    }

    lines.push('## Per-store summary');
    lines.push('');
    lines.push('| Store | N | Agree | Outdated | Free wrong | Failed | Recommendation |');
    lines.push('|---|---|---|---|---|---|---|');
    const recommendations: Record<string, string> = {};
    for (const [store, arr] of Array.from(byStore.entries()).sort((a, b) => b[1].length - a[1].length)) {
        const tally = (v: string): number => arr.filter((r) => r.verdict === v).length;
        const agree = tally('agree') + tally('agree_oos');
        const outdated = tally('gg_outdated');
        const wrong = tally('free_wrong');
        const failed = tally('free_failed');
        const n = arr.length;
        let rec: string;
        if (failed > n * 0.1) rec = '⚠️ Investigate failures';
        else if (wrong > n * 0.1) rec = '⚠️ Investigate parser';
        else if (outdated > n * 0.3) rec = '✅ **Switch — fixes outdated**';
        else if (agree > n * 0.8) rec = '✅ **Safe to switch**';
        else rec = '🟡 Mixed';
        recommendations[store] = rec;
        lines.push(`| ${store} | ${n} | ${agree} | ${outdated} | ${wrong} | ${failed} | ${rec} |`);
    }
    lines.push('');

    // gg_outdated cases — these are the silent-wrong-prices
    const outdated = results.filter((r) => r.verdict === 'gg_outdated').sort((a, b) => (b.drift_pct ?? 0) - (a.drift_pct ?? 0));
    if (outdated.length) {
        lines.push(`## GG outdated prices (Free Extractor will fix these on switch)`);
        lines.push('');
        lines.push(`**${outdated.length} products** where GG currently shows a wrong price. Switching to Free Extractor brings GG in sync with reality.`);
        lines.push('');
        lines.push('| Store | Product | GG price | Free price | Drift % | Method |');
        lines.push('|---|---|---|---|---|---|');
        for (const r of outdated.slice(0, 100)) {
            lines.push(`| ${r.store} | ${r.name.slice(0, 50)} | €${r.gg_price} | €${r.free_price?.toFixed(2)} | ${r.drift_pct?.toFixed(1)}% | ${r.free_method} |`);
        }
        lines.push('');
    }

    // free_wrong cases — needs investigation
    const wrong = results.filter((r) => r.verdict === 'free_wrong').sort((a, b) => (b.drift_pct ?? 0) - (a.drift_pct ?? 0));
    if (wrong.length) {
        lines.push(`## Suspicious large drifts (>${OUTDATED_THRESHOLD}%) — investigate manually`);
        lines.push('');
        lines.push('Could be: free method picked wrong variant, OR GG has very stale data. Inspect URL to confirm.');
        lines.push('');
        lines.push('| Store | Product | GG price | Free price | Drift % | Method | Candidates |');
        lines.push('|---|---|---|---|---|---|---|');
        for (const r of wrong.slice(0, 50)) {
            const cands = r.free_candidates ? Object.entries(r.free_candidates).map(([m, v]) => `${m}=€${v.price}`).join(', ') : '-';
            lines.push(`| ${r.store} | ${r.name.slice(0, 40)} | €${r.gg_price} | €${r.free_price?.toFixed(2)} | ${r.drift_pct?.toFixed(1)}% | ${r.free_method} | ${cands} |`);
        }
        lines.push('');
    }

    // free_failed cases
    const failed = results.filter((r) => r.verdict === 'free_failed');
    if (failed.length) {
        lines.push('## Free extractor failed');
        lines.push('');
        lines.push('| Store | Product | Error |');
        lines.push('|---|---|---|');
        for (const r of failed.slice(0, 30)) {
            lines.push(`| ${r.store} | ${r.name.slice(0, 50)} | ${r.free_error?.slice(0, 100)} |`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

const concurrency = parseInt(process.argv.find((a) => a.startsWith('--c'))?.split('=')[1] ?? '10', 10);

const products = await fetchTierAProducts();
console.log(`[validate] ${products.length} Tier A products to test across ${new Set(products.map((p) => p.store)).size} stores`);
console.log(`[validate] Concurrency: ${concurrency}`);
console.log(`[validate] Launching Playwright browser for anti-bot fallback...`);

const browser = await createBrowser();

const results = await runWithConcurrency(products, concurrency, async (p, i) => {
    const r = await validateOne(p, browser);
    const status = r.verdict === 'agree' ? '✓' : r.verdict === 'gg_outdated' ? '~' : r.verdict === 'free_failed' ? '✗' : '?';
    const drift = r.drift_pct !== undefined ? ` Δ${r.drift_pct.toFixed(0)}%` : '';
    const fm = r.free_fetch_method === 'playwright' ? ' [pw]' : '';
    console.log(`[${i + 1}/${products.length}] ${status} ${p.store} | ${p.name.slice(0, 40)} | gg=€${p.price} free=€${r.free_price ?? 'fail'}${drift}${fm}`);
    return r;
});

await browser.close().catch(() => undefined);

await mkdir(REPORT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(resolve(REPORT_DIR, `validation-${ts}.json`), JSON.stringify(results, null, 2));
const md = summarize(results);
await writeFile(resolve(REPORT_DIR, `validation-${ts}.md`), md);

console.log('');
console.log(`[validate] Done. Reports in: ${REPORT_DIR}`);
console.log('');
console.log(md.split('## GG outdated prices')[0]);

process.exit(0);
