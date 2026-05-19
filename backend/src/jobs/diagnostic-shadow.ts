// Local diagnostic: scrape a sample of real products with BOTH the current
// XPath/Selenium actions AND the new Anthropic Haiku extractor, then compare.
//
// Run with:
//   pnpm tsx src/jobs/diagnostic-shadow.ts -- --limit 30 --concurrency 3
//
// Requires ANTHROPIC_API_KEY in backend/.env. Does NOT touch Firestore.

import { configDotenv } from 'dotenv';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowser, createPage } from '../scraper/driver.js';
import { dismissCookieBanner, executeActions } from '../scraper/actions.js';
import { anthropicExtractPrice } from '../scraper/extractor-anthropic.js';
import { cleanPrice } from '../lib/utils.js';
import type { Browser } from 'playwright';
import type { ScraperAction } from '@eiwittens/types';

configDotenv();

const BACKEND_API = 'https://eiwittens-backend-16129604687.europe-west4.run.app/products?type=MINIMAL';
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'diagnostic-reports');

interface ApiProduct {
    id: string;
    name: string;
    url: string;
    store: string;
    type: string;
    price: number;
    enabled: boolean;
    scrape_enabled: boolean;
    out_of_stock: boolean;
    amount?: number;
    discount_type?: string;
    discount_value?: number;
}

interface ProductDetail extends ApiProduct {
    scraper: ScraperAction[];
    cookieBannerXPaths?: string[];
}

interface DiagnosticResult {
    productId: string;
    name: string;
    store: string;
    url: string;
    type: string;
    referencePrice: number;
    hasXpathConfigured: boolean;

    xpathPrice: number | null;
    xpathError?: string;
    xpathDurationMs: number;

    aiPrice: number | null;
    aiRawPrice?: string;
    aiSelector?: string;
    aiError?: string;
    aiDurationMs: number;

    verdict: 'agree' | 'close' | 'divergent' | 'xpath_only' | 'ai_only' | 'both_failed';
    divergencePct?: number;
}

interface CliOptions {
    limit: number;
    concurrency: number;
    storeFilter?: string;
    typeFilter?: string;
    productIds?: string[];
}

function parseArgs(args: string[]): CliOptions {
    const options: CliOptions = { limit: 30, concurrency: 3 };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--') continue;
        if (a === '--limit' || a === '-l') options.limit = parseInt(args[++i], 10);
        else if (a === '--concurrency' || a === '-c') options.concurrency = parseInt(args[++i], 10);
        else if (a === '--store') options.storeFilter = args[++i];
        else if (a === '--type') options.typeFilter = args[++i];
        else if (a === '--ids') options.productIds = args[++i].split(',');
    }
    return options;
}

async function fetchAllProducts(): Promise<ApiProduct[]> {
    const res = await fetch(BACKEND_API);
    if (!res.ok) throw new Error(`Failed to fetch products: ${res.status}`);
    return await res.json() as ApiProduct[];
}

// Stratified sample: ensure variety across stores and types
function stratifiedSample(products: ApiProduct[], limit: number): ApiProduct[] {
    const byStore = new Map<string, ApiProduct[]>();
    for (const p of products) {
        if (!p.enabled || !p.scrape_enabled || p.out_of_stock) continue;
        if (!p.price || p.price <= 0) continue;
        const arr = byStore.get(p.store) ?? [];
        arr.push(p);
        byStore.set(p.store, arr);
    }

    // Sort stores by size desc, take roughly proportional samples
    const stores = Array.from(byStore.entries()).sort((a, b) => b[1].length - a[1].length);
    const sample: ApiProduct[] = [];
    const totalProducts = stores.reduce((sum, [, arr]) => sum + arr.length, 0);

    for (const [, arr] of stores) {
        if (sample.length >= limit) break;
        const take = Math.max(1, Math.round((arr.length / totalProducts) * limit));
        // Shuffle within store and take first N
        const shuffled = [...arr].sort(() => Math.random() - 0.5);
        sample.push(...shuffled.slice(0, take));
    }

    return sample.slice(0, limit);
}

async function fetchProductDetail(id: string): Promise<ProductDetail | null> {
    const res = await fetch(`https://eiwittens-backend-16129604687.europe-west4.run.app/products/${id}`);
    if (!res.ok) return null;
    return await res.json() as ProductDetail;
}

async function diagnoseProduct(product: ApiProduct, browser: Browser): Promise<DiagnosticResult> {
    const result: DiagnosticResult = {
        productId: product.id,
        name: product.name,
        store: product.store,
        url: product.url,
        type: product.type,
        referencePrice: product.price,
        hasXpathConfigured: false,
        xpathPrice: null,
        xpathDurationMs: 0,
        aiPrice: null,
        aiDurationMs: 0,
        verdict: 'both_failed',
    };

    // Need full product (with scraper actions + cookie banner xpaths) — public API has those for non-MINIMAL fetch
    const detail = await fetchProductDetail(product.id);
    if (!detail) {
        result.xpathError = 'Could not fetch product detail';
        result.aiError = 'Could not fetch product detail';
        return result;
    }

    result.hasXpathConfigured = (detail.scraper?.length ?? 0) > 0;

    const { page, cleanup } = await createPage(browser);
    try {
        await page.goto(detail.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await dismissCookieBanner(page, detail.cookieBannerXPaths ?? []);

        // 1) XPath/CSS path
        if (result.hasXpathConfigured) {
            const xpathStart = Date.now();
            try {
                const raw = await executeActions(page, detail.scraper);
                result.xpathPrice = cleanPrice(raw);
                if (result.xpathPrice <= 0) {
                    result.xpathError = `Invalid price from XPath: "${raw}"`;
                    result.xpathPrice = null;
                }
            } catch (err) {
                result.xpathError = (err as Error).message.slice(0, 200);
            }
            result.xpathDurationMs = Date.now() - xpathStart;
        }

        // 2) Re-navigate fresh for AI (in case XPath altered DOM via Click/Select)
        await page.goto(detail.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await dismissCookieBanner(page, detail.cookieBannerXPaths ?? []);

        // 3) Anthropic path
        const aiStart = Date.now();
        try {
            const aiResult = await anthropicExtractPrice(page, detail.url);
            result.aiPrice = aiResult.price;
            result.aiRawPrice = aiResult.rawAiPrice;
            result.aiSelector = aiResult.fixedScraper[0]
                ? `[${aiResult.fixedScraper[0].type === 'select' ? (aiResult.fixedScraper[0] as { selectorType: string }).selectorType : 'unknown'}] ${(aiResult.fixedScraper[0] as { selectorValue?: string }).selectorValue ?? ''}`
                : '(price-text fallback)';
        } catch (err) {
            result.aiError = (err as Error).message.slice(0, 200);
        }
        result.aiDurationMs = Date.now() - aiStart;
    } finally {
        await cleanup();
    }

    // Compute verdict
    const x = result.xpathPrice;
    const a = result.aiPrice;
    if (x !== null && a !== null) {
        const diff = Math.abs(x - a);
        const pct = (diff / Math.max(x, a)) * 100;
        result.divergencePct = pct;
        if (diff < 0.01) result.verdict = 'agree';
        else if (pct < 5) result.verdict = 'close';
        else result.verdict = 'divergent';
    } else if (x !== null) result.verdict = 'xpath_only';
    else if (a !== null) result.verdict = 'ai_only';

    return result;
}

async function runWithConcurrency(
    sample: ApiProduct[],
    concurrency: number,
): Promise<DiagnosticResult[]> {
    const browsers: Browser[] = await Promise.all(
        Array.from({ length: concurrency }, () => createBrowser()),
    );
    const results: DiagnosticResult[] = [];
    let nextIndex = 0;
    const total = sample.length;

    try {
        await Promise.all(browsers.map(async (browser) => {
            while (nextIndex < total) {
                const idx = nextIndex++;
                const product = sample[idx];
                console.log(`[${idx + 1}/${total}] ${product.store} | ${product.name.slice(0, 60)}`);
                try {
                    const result = await diagnoseProduct(product, browser);
                    results.push(result);
                    const x = result.xpathPrice === null ? 'NULL' : `€${result.xpathPrice}`;
                    const a = result.aiPrice === null ? 'NULL' : `€${result.aiPrice}`;
                    const r = `€${result.referencePrice}`;
                    console.log(`  → xpath=${x} ai=${a} ref=${r} verdict=${result.verdict}`);
                } catch (err) {
                    console.error(`  ✗ FAILED: ${(err as Error).message}`);
                    results.push({
                        productId: product.id,
                        name: product.name,
                        store: product.store,
                        url: product.url,
                        type: product.type,
                        referencePrice: product.price,
                        hasXpathConfigured: false,
                        xpathPrice: null,
                        xpathError: 'Unexpected: ' + (err as Error).message.slice(0, 200),
                        xpathDurationMs: 0,
                        aiPrice: null,
                        aiError: 'Unexpected: ' + (err as Error).message.slice(0, 200),
                        aiDurationMs: 0,
                        verdict: 'both_failed',
                    });
                }
            }
        }));
    } finally {
        await Promise.all(browsers.map((b) => b.close().catch(() => undefined)));
    }

    return results;
}

function summarize(results: DiagnosticResult[]): string {
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;

    const lines: string[] = [];
    lines.push('# Diagnostic Shadow Report');
    lines.push('');
    lines.push(`*Generated: ${new Date().toISOString()}*`);
    lines.push(`*Sample size: ${results.length} products*`);
    lines.push('');
    lines.push('## Verdict counts');
    lines.push('');
    lines.push('| Verdict | Count | %');
    lines.push('|---|---|---|');
    for (const [v, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        lines.push(`| \`${v}\` | ${c} | ${((c / results.length) * 100).toFixed(1)}% |`);
    }
    lines.push('');
    lines.push('**Verdict definitions:**');
    lines.push('- `agree` — XPath and Haiku returned the same price (< €0.01 diff)');
    lines.push('- `close` — diff < 5% (likely discount applied differently)');
    lines.push('- `divergent` — diff ≥ 5% (one of them is wrong)');
    lines.push('- `xpath_only` — Haiku failed, XPath worked');
    lines.push('- `ai_only` — XPath failed, Haiku worked');
    lines.push('- `both_failed` — neither worked');
    lines.push('');

    // Per-store breakdown
    const byStore = new Map<string, DiagnosticResult[]>();
    for (const r of results) {
        const arr = byStore.get(r.store) ?? [];
        arr.push(r);
        byStore.set(r.store, arr);
    }
    lines.push('## Per-store performance');
    lines.push('');
    lines.push('| Store | N | Agree | Close | Divergent | XPath-only | AI-only | Both failed |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const [store, arr] of Array.from(byStore.entries()).sort((a, b) => b[1].length - a[1].length)) {
        const tally = (v: string): number => arr.filter((r) => r.verdict === v).length;
        lines.push(`| ${store} | ${arr.length} | ${tally('agree')} | ${tally('close')} | ${tally('divergent')} | ${tally('xpath_only')} | ${tally('ai_only')} | ${tally('both_failed')} |`);
    }
    lines.push('');

    // Divergent cases
    const divergent = results.filter((r) => r.verdict === 'divergent');
    if (divergent.length) {
        lines.push('## Divergent cases (XPath vs Haiku ≥ 5% apart)');
        lines.push('');
        lines.push('These are the most interesting cases — one of them is likely wrong.');
        lines.push('');
        lines.push('| Store | Product | XPath | Haiku | Ref | % diff | URL |');
        lines.push('|---|---|---|---|---|---|---|');
        for (const r of divergent.sort((a, b) => (b.divergencePct ?? 0) - (a.divergencePct ?? 0))) {
            lines.push(`| ${r.store} | ${r.name.slice(0, 40)} | €${r.xpathPrice} | €${r.aiPrice} | €${r.referencePrice} | ${r.divergencePct?.toFixed(1)}% | [link](${r.url}) |`);
        }
        lines.push('');
    }

    // XPath failures
    const xpathFails = results.filter((r) => r.xpathError);
    if (xpathFails.length) {
        lines.push('## XPath failures');
        lines.push('');
        lines.push('| Store | Product | Error |');
        lines.push('|---|---|---|');
        for (const r of xpathFails.slice(0, 30)) {
            lines.push(`| ${r.store} | ${r.name.slice(0, 50)} | ${r.xpathError?.slice(0, 80)} |`);
        }
        lines.push('');
    }

    // AI failures
    const aiFails = results.filter((r) => r.aiError);
    if (aiFails.length) {
        lines.push('## Haiku failures');
        lines.push('');
        lines.push('| Store | Product | Error |');
        lines.push('|---|---|---|');
        for (const r of aiFails.slice(0, 30)) {
            lines.push(`| ${r.store} | ${r.name.slice(0, 50)} | ${r.aiError?.slice(0, 80)} |`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

const options = parseArgs(process.argv.slice(2));
console.log(`[diagnostic] Starting with limit=${options.limit}, concurrency=${options.concurrency}`);

if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set in backend/.env');
    process.exit(1);
}

const all = await fetchAllProducts();
console.log(`[diagnostic] Fetched ${all.length} products from public API`);

let pool = all.filter((p) => p.enabled && p.scrape_enabled && !p.out_of_stock && p.price > 0);
if (options.storeFilter) pool = pool.filter((p) => p.store === options.storeFilter);
if (options.typeFilter) pool = pool.filter((p) => p.type === options.typeFilter);
if (options.productIds?.length) pool = pool.filter((p) => options.productIds!.includes(p.id));

let sample: ApiProduct[];
if (options.productIds?.length) {
    sample = pool;
} else {
    sample = stratifiedSample(pool, options.limit);
}
console.log(`[diagnostic] Stratified sample: ${sample.length} products across ${new Set(sample.map((p) => p.store)).size} stores`);

const results = await runWithConcurrency(sample, options.concurrency);

await mkdir(REPORT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const jsonPath = resolve(REPORT_DIR, `diagnostic-${ts}.json`);
const mdPath = resolve(REPORT_DIR, `diagnostic-${ts}.md`);

await writeFile(jsonPath, JSON.stringify(results, null, 2));
await writeFile(mdPath, summarize(results));

console.log('');
console.log(`[diagnostic] Done. Reports:`);
console.log(`  JSON: ${jsonPath}`);
console.log(`  MD:   ${mdPath}`);
console.log('');
console.log(summarize(results).split('## Per-store performance')[0]);

process.exit(0);
