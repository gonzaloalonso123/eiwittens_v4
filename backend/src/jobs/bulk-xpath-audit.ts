// Audit the existing XPath scraper configuration for all Bulk products.
//
// For each Bulk product:
//   1. Fetch full product data (including scraper actions)
//   2. Run the current XPath/Click/Select actions on a fresh Playwright page
//   3. Compare resulting price with GG's stored price + with Bulk's JSON-LD master price
//   4. Classify: working / outdated / wrong-variant / broken
//
// Run with:
//   pnpm tsx src/jobs/bulk-xpath-audit.ts -- --concurrency 3 --limit 62
//
// No Firestore writes. No alerts. Local diagnostic only.

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowser, createPage } from '../scraper/driver.js';
import { dismissCookieBanner, executeActions } from '../scraper/actions.js';
import { cleanPrice } from '../lib/utils.js';
import { extractFromHtml } from '../scraper/free-extractor.js';
import type { Browser } from 'playwright';

const BACKEND_API = 'https://eiwittens-backend-16129604687.europe-west4.run.app';
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'bulk-audit-reports');

interface ScraperAction {
    id: string;
    type: 'click' | 'select' | 'selectOption' | 'wait';
    selectorType?: 'css' | 'xpath';
    selectorValue?: string;
    optionText?: string;
    duration?: number;
}

interface FullProduct {
    id: string;
    name: string;
    store: string;
    url: string;
    image?: string;
    price: number;
    amount?: number;
    type: string;
    enabled: boolean;
    scrape_enabled: boolean;
    out_of_stock: boolean;
    scraper: ScraperAction[];
    cookieBannerXPaths?: string[];
    scrapeTarget?: { requiredTexts?: string[]; preferredOptionTexts?: string[]; rejectTexts?: string[] };
}

interface AuditResult {
    productId: string;
    name: string;
    url: string;
    gg_price: number;
    amount?: number;

    // Action config inspection
    has_scraper: boolean;
    action_count: number;
    has_click: boolean;
    has_select_option: boolean;
    has_select: boolean;
    action_summary: string;

    // Live re-scrape
    scraped_price?: number;
    scrape_error?: string;
    scrape_duration_ms: number;

    // Comparison with JSON-LD master price (cheapest variant)
    master_price?: number;
    master_error?: string;

    // Diagnostics
    xpath_vs_gg_drift_pct?: number;
    scraped_vs_master_ratio?: number;
    verdict: 'working_correctly' | 'gg_stale_but_xpath_works' | 'xpath_broken' | 'no_xpath_configured' | 'variant_smaller_than_expected' | 'unclear';
    diagnosis: string;
}

async function fetchAllBulkProducts(): Promise<{ id: string }[]> {
    const res = await fetch(`${BACKEND_API}/products?type=MINIMAL`);
    const all = await res.json() as Array<{ id: string; store: string; enabled: boolean; scrape_enabled: boolean; out_of_stock: boolean }>;
    return all.filter((p) => p.store === 'Bulk' && p.enabled && p.scrape_enabled && !p.out_of_stock);
}

async function fetchProductDetail(id: string): Promise<FullProduct | null> {
    const res = await fetch(`${BACKEND_API}/products/${id}`);
    if (!res.ok) return null;
    return await res.json() as FullProduct;
}

function summarizeActions(actions: ScraperAction[]): string {
    if (!actions || actions.length === 0) return '(empty)';
    return actions.map((a) => {
        if (a.type === 'click') return `Click(${a.selectorValue?.slice(0, 30)})`;
        if (a.type === 'selectOption') return `SelectOpt(${a.optionText})`;
        if (a.type === 'select') return `Select(${a.selectorValue?.slice(0, 30)})`;
        if (a.type === 'wait') return `Wait(${a.duration ?? 2000}ms)`;
        return a.type;
    }).join(' → ');
}

async function auditOne(product: FullProduct, browser: Browser): Promise<AuditResult> {
    const result: AuditResult = {
        productId: product.id,
        name: product.name,
        url: product.url,
        gg_price: product.price,
        amount: product.amount,
        has_scraper: (product.scraper?.length ?? 0) > 0,
        action_count: product.scraper?.length ?? 0,
        has_click: (product.scraper ?? []).some((a) => a.type === 'click'),
        has_select_option: (product.scraper ?? []).some((a) => a.type === 'selectOption'),
        has_select: (product.scraper ?? []).some((a) => a.type === 'select'),
        action_summary: summarizeActions(product.scraper ?? []),
        scrape_duration_ms: 0,
        verdict: 'unclear',
        diagnosis: '',
    };

    if (!result.has_scraper) {
        result.verdict = 'no_xpath_configured';
        result.diagnosis = 'No scraper actions configured';
        return result;
    }

    const { page, cleanup } = await createPage(browser);
    try {
        // 1. Live re-scrape with current actions
        const scrapeStart = Date.now();
        try {
            await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await dismissCookieBanner(page, product.cookieBannerXPaths ?? []);
            const raw = await executeActions(page, product.scraper as never);
            const price = cleanPrice(raw);
            if (price > 0) {
                result.scraped_price = price;
            } else {
                result.scrape_error = `Empty/zero price: "${raw}"`;
            }
        } catch (err) {
            result.scrape_error = (err as Error).message.slice(0, 200);
        }
        result.scrape_duration_ms = Date.now() - scrapeStart;

        // 2. Fetch master JSON-LD (cheapest variant — what Free Extractor returns)
        try {
            await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await dismissCookieBanner(page, product.cookieBannerXPaths ?? []);
            const html = await page.content();
            const free = await extractFromHtml(html, page.url(), { amountGrams: product.amount });
            result.master_price = free.price;
        } catch (err) {
            result.master_error = (err as Error).message.slice(0, 200);
        }
    } finally {
        await cleanup();
    }

    // Classify
    const scraped = result.scraped_price;
    const master = result.master_price;
    const gg = result.gg_price;

    if (scraped === undefined) {
        result.verdict = 'xpath_broken';
        result.diagnosis = `Current XPath fails: ${result.scrape_error}`;
        return result;
    }

    const xpathDrift = Math.abs(scraped - gg) / Math.max(scraped, gg);
    result.xpath_vs_gg_drift_pct = xpathDrift * 100;

    if (master !== undefined && master > 0) {
        result.scraped_vs_master_ratio = scraped / master;
    }

    if (xpathDrift < 0.02) {
        // XPath matches GG → both are in sync
        // But is GG correct? Check vs master:
        if (master && scraped < master * 0.7) {
            result.verdict = 'variant_smaller_than_expected';
            result.diagnosis = `XPath returns €${scraped} matching GG, but Free Extractor master price is €${master}. Possible: XPath picks cheapest variant from page (e.g. didn't click size button).`;
        } else {
            result.verdict = 'working_correctly';
            result.diagnosis = `XPath and GG agree at €${scraped}. Bulk page master at €${master}. Click+Select actions appear to work.`;
        }
    } else if (xpathDrift > 0.05 && xpathDrift < 0.5) {
        result.verdict = 'gg_stale_but_xpath_works';
        result.diagnosis = `XPath returns €${scraped} but GG has €${gg} (drift ${(xpathDrift * 100).toFixed(1)}%). XPath is current; GG database is stale.`;
    } else {
        result.verdict = 'xpath_broken';
        result.diagnosis = `Large drift: scraped €${scraped} vs GG €${gg} (${(xpathDrift * 100).toFixed(1)}%). XPath result implausible.`;
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

function buildReport(results: AuditResult[]): string {
    const lines: string[] = [];
    lines.push('# Bulk XPath Audit Report');
    lines.push('');
    lines.push(`*Generated: ${new Date().toISOString()}*`);
    lines.push(`*Products audited: ${results.length}*`);
    lines.push('');

    const counts: Record<string, number> = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;

    lines.push('## Verdict counts');
    lines.push('');
    lines.push('| Verdict | Count | % |');
    lines.push('|---|---|---|');
    for (const [v, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        lines.push(`| \`${v}\` | ${c} | ${((c / results.length) * 100).toFixed(0)}% |`);
    }
    lines.push('');
    lines.push('**Verdicts:**');
    lines.push('- `working_correctly` — XPath + GG agree, and price seems realistic for variant');
    lines.push('- `gg_stale_but_xpath_works` — XPath now returns different (likely current) price; GG database has stale data');
    lines.push('- `variant_smaller_than_expected` — XPath returns price matching cheapest variant; Click action may not be working');
    lines.push('- `xpath_broken` — Live scrape fails or returns implausible price');
    lines.push('- `no_xpath_configured` — Product has empty scraper actions array');
    lines.push('');

    // Section: per product
    lines.push('## Per-product details');
    lines.push('');
    lines.push('| Product | Amount | GG | Scraped | Master | XPath drift | Verdict | Actions |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const r of results) {
        const amt = r.amount ? `${r.amount}g` : '-';
        const scraped = r.scraped_price ? `€${r.scraped_price.toFixed(2)}` : 'FAIL';
        const master = r.master_price ? `€${r.master_price.toFixed(2)}` : '-';
        const drift = r.xpath_vs_gg_drift_pct !== undefined ? `${r.xpath_vs_gg_drift_pct.toFixed(0)}%` : '-';
        lines.push(`| ${r.name.slice(0, 40)} | ${amt} | €${r.gg_price} | ${scraped} | ${master} | ${drift} | \`${r.verdict}\` | ${r.action_summary.slice(0, 60)} |`);
    }
    lines.push('');

    // Section: broken cases (deep)
    const broken = results.filter((r) => r.verdict === 'xpath_broken' || r.verdict === 'variant_smaller_than_expected');
    if (broken.length) {
        lines.push('## Cases needing fix');
        lines.push('');
        for (const r of broken) {
            lines.push(`### ${r.name}`);
            lines.push(`- URL: ${r.url.slice(0, 150)}`);
            lines.push(`- Diagnosis: ${r.diagnosis}`);
            lines.push(`- Current actions: ${r.action_summary}`);
            lines.push(`- GG: €${r.gg_price} | Scraped: €${r.scraped_price ?? 'FAIL'} | Master: €${r.master_price ?? '-'}`);
            lines.push('');
        }
    }

    return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

const concurrency = parseInt(process.argv.find((a) => a.startsWith('--c'))?.split('=')[1] ?? '3', 10);
const limit = parseInt(process.argv.find((a) => a.startsWith('--l'))?.split('=')[1] ?? '100', 10);

console.log('[bulk-audit] Fetching Bulk product IDs...');
const ids = await fetchAllBulkProducts();
console.log(`[bulk-audit] ${ids.length} active Bulk products`);

const toAudit = ids.slice(0, limit);
console.log(`[bulk-audit] Auditing ${toAudit.length} products with concurrency=${concurrency}`);
console.log(`[bulk-audit] Fetching full product details for each...`);

const fullProducts: FullProduct[] = [];
for (const { id } of toAudit) {
    const full = await fetchProductDetail(id);
    if (full) fullProducts.push(full);
}
console.log(`[bulk-audit] Loaded ${fullProducts.length} full product configs`);

console.log(`[bulk-audit] Launching Playwright browser...`);
const browser = await createBrowser();

const results = await runWithConcurrency(fullProducts, concurrency, async (p, i) => {
    const r = await auditOne(p, browser);
    const status = r.verdict === 'working_correctly' ? '✓' : r.verdict === 'gg_stale_but_xpath_works' ? '~' : '✗';
    console.log(`[${i + 1}/${fullProducts.length}] ${status} ${r.name.slice(0, 50)} | gg=€${r.gg_price} scraped=€${r.scraped_price ?? 'FAIL'} master=€${r.master_price ?? '-'} verdict=${r.verdict}`);
    return r;
});

await browser.close().catch(() => undefined);

await mkdir(REPORT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(resolve(REPORT_DIR, `bulk-audit-${ts}.json`), JSON.stringify(results, null, 2));
const md = buildReport(results);
await writeFile(resolve(REPORT_DIR, `bulk-audit-${ts}.md`), md);

console.log('');
console.log(`[bulk-audit] Done. Reports in: ${REPORT_DIR}`);
console.log('');
console.log(md.split('## Per-product details')[0]);

process.exit(0);
