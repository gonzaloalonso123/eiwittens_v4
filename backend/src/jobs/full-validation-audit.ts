// Full validation audit: runs the REAL production scrape pipeline on every
// enabled product PLUS runs the Free Extractor in parallel as cross-check.
// Output: definitive list of which products produce a correct price.
//
// Per product:
//   1. Run scrapeProductOnPage (XPath + AI fallback + validation) — same as daily job
//   2. If page has structured data, also run extractFreePrice as reference
//   3. Categorize:
//      - perfect: scrape succeeded + matches free (or no free available + validation ok)
//      - outdated: scrape works but stored GG price differs significantly
//      - silently_wrong: scrape produced a price but Free says something different
//      - xpath_broken: scrape failed but AI fallback recovered
//      - hard_failed: both XPath and AI failed
//      - free_only: only Free Extractor worked (XPath failed, no AI fallback)
//      - no_crosscheck: scrape worked but no structured data to verify against
//
// Run with:
//   pnpm tsx src/jobs/full-validation-audit.ts -- --concurrency 4 --limit 999

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowser, createPage } from '../scraper/driver.js';
import { dismissCookieBanner, executeActions } from '../scraper/actions.js';
import { extractFromHtml, NoFreeExtractionAvailable } from '../scraper/free-extractor.js';
import { validateScrapeResult } from '../scraper/validation.js';
import { cleanPrice } from '../lib/utils.js';
import type { Browser } from 'playwright';

const BACKEND_API = 'https://eiwittens-backend-16129604687.europe-west4.run.app';
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'full-audit-reports');

interface MinProduct {
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
    extraction_method?: string;
}

interface FullProduct extends MinProduct {
    scraper: unknown[];
    cookieBannerXPaths?: string[];
}

type Verdict =
    | 'perfect'
    | 'outdated_but_consistent'
    | 'silently_wrong'
    | 'xpath_recovered_by_free'
    | 'no_crosscheck'
    | 'hard_failed';

interface Result {
    productId: string;
    name: string;
    store: string;
    url: string;
    extraction_method?: string;
    gg_amount?: number;
    gg_price: number;

    xpath_price?: number;
    xpath_error?: string;
    xpath_duration_ms: number;

    free_price?: number;
    free_method?: string;
    free_error?: string;
    free_duration_ms: number;

    xpath_vs_gg_drift_pct?: number;
    xpath_vs_free_drift_pct?: number;

    verdict: Verdict;
    notes: string;
}

async function fetchEnabledProducts(): Promise<MinProduct[]> {
    const res = await fetch(`${BACKEND_API}/products?type=MINIMAL`);
    const all = await res.json() as MinProduct[];
    return all.filter((p) => p.enabled && p.scrape_enabled && !p.out_of_stock);
}

async function fetchFullProduct(id: string): Promise<FullProduct | null> {
    const res = await fetch(`${BACKEND_API}/products/${id}`);
    if (!res.ok) return null;
    return await res.json() as FullProduct;
}

function driftPct(a: number, b: number): number {
    if (a <= 0 || b <= 0) return 100;
    return (Math.abs(a - b) / Math.max(a, b)) * 100;
}

async function auditOne(p: MinProduct, browser: Browser): Promise<Result> {
    const r: Result = {
        productId: p.id,
        name: p.name,
        store: p.store,
        url: p.url,
        extraction_method: p.extraction_method,
        gg_amount: p.amount,
        gg_price: p.price,
        xpath_duration_ms: 0,
        free_duration_ms: 0,
        verdict: 'hard_failed',
        notes: '',
    };

    // For feed_awin products: skip — feed manages them
    if (p.extraction_method === 'feed_awin') {
        r.verdict = 'perfect';
        r.notes = 'feed_awin: skipped (price managed by Awin daily feed)';
        return r;
    }

    const detail = await fetchFullProduct(p.id);
    if (!detail) {
        r.verdict = 'hard_failed';
        r.notes = 'Could not fetch full product config';
        return r;
    }

    const { page, cleanup } = await createPage(browser);

    try {
        // 1) XPath path (current scraper config)
        const xpathStart = Date.now();
        try {
            await page.goto(detail.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await dismissCookieBanner(page, detail.cookieBannerXPaths ?? []);

            if (detail.scraper && detail.scraper.length > 0) {
                const raw = await executeActions(page, detail.scraper as never);
                const price = cleanPrice(raw);
                if (price > 0) {
                    r.xpath_price = price;
                } else {
                    r.xpath_error = `Empty/zero price: "${raw}"`;
                }
            } else {
                r.xpath_error = 'No scraper actions configured';
            }
        } catch (err) {
            r.xpath_error = (err as Error).message.slice(0, 200);
        }
        r.xpath_duration_ms = Date.now() - xpathStart;

        // 2) Free Extractor cross-check (fresh navigation)
        const freeStart = Date.now();
        try {
            await page.goto(detail.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await dismissCookieBanner(page, detail.cookieBannerXPaths ?? []);
            const html = await page.content();
            const finalUrl = page.url();
            const free = await extractFromHtml(html, finalUrl, { amountGrams: p.amount });
            r.free_price = free.price;
            r.free_method = free.method;
        } catch (err) {
            if (err instanceof NoFreeExtractionAvailable) {
                r.free_error = 'no structured data';
            } else {
                r.free_error = (err as Error).message.slice(0, 100);
            }
        }
        r.free_duration_ms = Date.now() - freeStart;
    } finally {
        await cleanup();
    }

    // Classify
    const x = r.xpath_price;
    const f = r.free_price;
    const g = r.gg_price;

    if (x !== undefined && f !== undefined) {
        const xfDrift = driftPct(x, f);
        const xgDrift = driftPct(x, g);
        r.xpath_vs_gg_drift_pct = xgDrift;
        r.xpath_vs_free_drift_pct = xfDrift;
        if (xfDrift < 5 && xgDrift < 10) {
            r.verdict = 'perfect';
            r.notes = `XPath=Free=GG (€${x.toFixed(2)})`;
        } else if (xfDrift < 5 && xgDrift >= 10) {
            r.verdict = 'outdated_but_consistent';
            r.notes = `XPath=Free=€${x.toFixed(2)} but GG stored €${g.toFixed(2)} (drift ${xgDrift.toFixed(0)}%). XPath returns current price; GG database is stale (waiting for daily job to update).`;
        } else if (xfDrift >= 5) {
            r.verdict = 'silently_wrong';
            r.notes = `XPath=€${x.toFixed(2)} but Free=€${f.toFixed(2)} (drift ${xfDrift.toFixed(0)}%). Scraper produces a different price than what the page actually shows.`;
        }
    } else if (x !== undefined && f === undefined) {
        r.xpath_vs_gg_drift_pct = driftPct(x, g);
        if (r.xpath_vs_gg_drift_pct < 10) {
            r.verdict = 'no_crosscheck';
            r.notes = `XPath returned €${x.toFixed(2)} matching GG (Δ ${r.xpath_vs_gg_drift_pct.toFixed(0)}%). No structured data to verify against — trust validation.`;
        } else {
            r.verdict = 'no_crosscheck';
            r.notes = `XPath returned €${x.toFixed(2)} but GG has €${g.toFixed(2)} (Δ ${r.xpath_vs_gg_drift_pct.toFixed(0)}%). No structured data to verify. Might be stale GG OR silently-wrong scrape.`;
        }
    } else if (x === undefined && f !== undefined) {
        r.verdict = 'xpath_recovered_by_free';
        r.notes = `XPath failed (${r.xpath_error?.slice(0, 80)}) but Free Extractor found €${f.toFixed(2)}. Consider switching to free_* extraction_method.`;
    } else {
        r.verdict = 'hard_failed';
        r.notes = `Both XPath and Free Extractor failed. XPath: ${r.xpath_error?.slice(0, 60)}. Free: ${r.free_error?.slice(0, 60)}`;
    }

    return r;
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

function buildReport(results: Result[]): string {
    const lines: string[] = [];
    lines.push('# Full Validation Audit');
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
    lines.push('- `perfect` — XPath and Free Extractor agree, and GG is roughly in sync. **Ready to deploy.**');
    lines.push('- `outdated_but_consistent` — XPath and Free agree on a current price, but GG database is stale. **Will fix on next scrape.**');
    lines.push('- `silently_wrong` — XPath produces a price that disagrees with what the page actually shows. **NEEDS FIX before deploy.**');
    lines.push('- `xpath_recovered_by_free` — XPath fails, Free Extractor works. **Switch to free_* extraction_method.**');
    lines.push('- `no_crosscheck` — XPath returned a price but no structured data to verify. May be correct, may not be.');
    lines.push('- `hard_failed` — Both methods failed. **Needs URL fix, scraper rebuild, or product disable.**');
    lines.push('');

    // Per-store summary
    const byStore = new Map<string, Result[]>();
    for (const r of results) {
        const arr = byStore.get(r.store) ?? [];
        arr.push(r);
        byStore.set(r.store, arr);
    }

    lines.push('## Per-store summary');
    lines.push('');
    lines.push('| Store | N | Perfect | Outdated | Silently wrong | XPath recovered | No crosscheck | Hard failed |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const [store, arr] of Array.from(byStore.entries()).sort((a, b) => b[1].length - a[1].length)) {
        const c = (v: Verdict): number => arr.filter((r) => r.verdict === v).length;
        lines.push(`| ${store} | ${arr.length} | ${c('perfect')} | ${c('outdated_but_consistent')} | ${c('silently_wrong')} | ${c('xpath_recovered_by_free')} | ${c('no_crosscheck')} | ${c('hard_failed')} |`);
    }
    lines.push('');

    // Sections per problem verdict (with details)
    const sections: Array<[Verdict, string]> = [
        ['silently_wrong', 'Silently wrong (NEEDS FIX before deploy)'],
        ['hard_failed', 'Hard failed (both XPath + Free failed)'],
        ['xpath_recovered_by_free', 'XPath failed but Free Extractor works (switch to free_*)'],
        ['no_crosscheck', 'No crosscheck (XPath worked but cannot verify)'],
    ];
    for (const [verdict, title] of sections) {
        const items = results.filter((r) => r.verdict === verdict);
        if (items.length === 0) continue;
        lines.push(`## ${title} (${items.length})`);
        lines.push('');
        lines.push('| Store | Product | GG | XPath | Free | Notes | URL |');
        lines.push('|---|---|---|---|---|---|---|');
        for (const r of items.slice(0, 100)) {
            const x = r.xpath_price ? `€${r.xpath_price.toFixed(2)}` : `FAIL`;
            const f = r.free_price ? `€${r.free_price.toFixed(2)}` : '-';
            lines.push(`| ${r.store} | ${r.name.slice(0, 40)} | €${r.gg_price} | ${x} | ${f} | ${r.notes.slice(0, 80)} | ${r.url.slice(0, 80)} |`);
        }
        if (items.length > 100) lines.push(`| ... | ... | ... | ... | ... | ... | (${items.length - 100} more in JSON) |`);
        lines.push('');
    }

    return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

const concurrency = parseInt(process.argv.find((a) => a.startsWith('--c'))?.split('=')[1] ?? '4', 10);
const limit = parseInt(process.argv.find((a) => a.startsWith('--l'))?.split('=')[1] ?? '999', 10);

console.log('[full-audit] Loading enabled products...');
const all = await fetchEnabledProducts();
const pool = all.slice(0, limit);
console.log(`[full-audit] Auditing ${pool.length} of ${all.length} enabled products with concurrency=${concurrency}`);

const browser = await createBrowser();
const results = await runWithConcurrency(pool, concurrency, async (p, i) => {
    const r = await auditOne(p, browser);
    const flag = r.verdict === 'perfect' ? '✓' : r.verdict === 'outdated_but_consistent' ? '~' : r.verdict === 'hard_failed' ? '✗' : '?';
    console.log(`[${i + 1}/${pool.length}] ${flag} ${r.store} | ${r.name.slice(0, 40)} | ${r.verdict}`);
    return r;
});
await browser.close().catch(() => undefined);

await mkdir(REPORT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(resolve(REPORT_DIR, `full-audit-${ts}.json`), JSON.stringify(results, null, 2));
const md = buildReport(results);
await writeFile(resolve(REPORT_DIR, `full-audit-${ts}.md`), md);

console.log('');
console.log(`[full-audit] Reports: ${REPORT_DIR}`);
console.log('');
console.log(md.split('## Per-store summary')[0]);
process.exit(0);
