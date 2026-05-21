// Data quality audit: walk every enabled product, fetch the URL, and verify:
//   - HTTP status (200 = ok, 404 = dead URL, 403 = anti-bot, other = inspect)
//   - Whether the stored `amount` appears anywhere on the page text
//     (catches mismatches like "GG says 250g but site only sells 500g")
//   - Final URL (catches stores that 301-redirected)
//
// Output: markdown report grouped by issue type.
//
// Run with:
//   pnpm tsx src/jobs/data-quality-audit.ts -- --concurrency 8 --limit 50

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowser } from '../scraper/driver.js';
import type { Browser } from 'playwright';

const BACKEND_API = 'https://eiwittens-backend-16129604687.europe-west4.run.app';
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'data-quality-reports');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
};

interface GgProduct {
    id: string;
    name: string;
    store: string;
    url: string;
    price: number;
    amount?: number;
    enabled: boolean;
    scrape_enabled: boolean;
    out_of_stock: boolean;
}

interface AuditResult {
    productId: string;
    name: string;
    store: string;
    url: string;
    finalUrl?: string;
    gg_amount?: number;
    http_status?: number;
    fetch_method: 'plain' | 'playwright' | 'failed';
    fetch_error?: string;
    amount_visible_on_page?: boolean;
    page_sizes_found?: string[];
    verdict: 'ok' | 'url_404' | 'url_403' | 'url_5xx' | 'url_redirected' | 'amount_mismatch' | 'fetch_failed';
    notes: string;
}

function amountToSearchStrings(grams?: number): string[] {
    if (!grams || !Number.isFinite(grams) || grams <= 0) return [];
    const out = new Set<string>();
    out.add(`${grams}g`);
    out.add(`${grams} g`);
    out.add(`${grams}gr`);
    if (grams >= 1000) {
        const kg = grams / 1000;
        const kgDot = kg % 1 === 0 ? String(kg) : String(parseFloat(kg.toFixed(2)));
        const kgComma = kgDot.replace('.', ',');
        for (const v of [kgDot, kgComma]) {
            out.add(`${v}kg`);
            out.add(`${v} kg`);
        }
    }
    return [...out];
}

function findSizeLabels(text: string): string[] {
    const matches = text.match(/\b\d+([.,]\d+)?\s*(kg|g|gr|gram|stuks|ml|caps|tabs)\b/gi) || [];
    return [...new Set(matches.map((m) => m.toLowerCase().replace(/\s+/g, '')))].slice(0, 20);
}

async function fetchPage(url: string, browser: Browser): Promise<{ html: string; finalUrl: string; status: number; method: 'plain' | 'playwright' }> {
    // Try plain fetch first
    try {
        const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
        const html = await res.text();
        return { html, finalUrl: res.url, status: res.status, method: 'plain' };
    } catch (err) {
        // Fall back to Playwright (handles JS-only, anti-bot)
        const context = await browser.newContext({
            userAgent: HEADERS['User-Agent'],
            locale: 'nl-NL',
            viewport: { width: 1920, height: 1080 },
        });
        try {
            const page = await context.newPage();
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
            const html = await page.content();
            return { html, finalUrl: page.url(), status: response?.status() ?? 0, method: 'playwright' };
        } finally {
            await context.close().catch(() => undefined);
        }
    }
}

async function auditOne(p: GgProduct, browser: Browser): Promise<AuditResult> {
    const result: AuditResult = {
        productId: p.id,
        name: p.name,
        store: p.store,
        url: p.url,
        gg_amount: p.amount,
        fetch_method: 'failed',
        verdict: 'fetch_failed',
        notes: '',
    };

    try {
        const { html, finalUrl, status, method } = await fetchPage(p.url, browser);
        result.fetch_method = method;
        result.http_status = status;
        result.finalUrl = finalUrl;

        if (status === 404) {
            result.verdict = 'url_404';
            result.notes = 'Page returns 404. URL needs refresh.';
            return result;
        }
        if (status === 403) {
            result.verdict = 'url_403';
            result.notes = 'Anti-bot block. URL may still be valid in browser.';
            return result;
        }
        if (status >= 500) {
            result.verdict = 'url_5xx';
            result.notes = `Server error ${status}.`;
            return result;
        }

        // Check for redirects to a different path (treat as suspect)
        try {
            const orig = new URL(p.url);
            const fin = new URL(finalUrl);
            const sameDomain = orig.hostname.replace(/^www\./, '') === fin.hostname.replace(/^www\./, '');
            const samePath = orig.pathname === fin.pathname;
            if (!samePath && status === 200) {
                // Redirect to different path — could be category, alternative product, etc.
                result.notes = `Redirected to different path: ${fin.pathname}`;
                if (!sameDomain) result.notes += ` (DIFFERENT DOMAIN: ${fin.hostname})`;
            }
        } catch {
            // ignore URL parse errors
        }

        // Strip HTML tags for text scan
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
        const sizesOnPage = findSizeLabels(text);
        result.page_sizes_found = sizesOnPage;

        // Check if GG amount appears
        const searchStrings = amountToSearchStrings(p.amount).map((s) => s.toLowerCase().replace(/\s+/g, ''));
        const visible = searchStrings.some((s) => sizesOnPage.includes(s));
        result.amount_visible_on_page = visible;

        if (!visible && p.amount && searchStrings.length > 0 && sizesOnPage.length > 0) {
            result.verdict = 'amount_mismatch';
            result.notes = `GG says ${p.amount}g but page sizes: ${sizesOnPage.slice(0, 5).join(', ')}`;
            return result;
        }

        // Check redirect verdict separately
        if (result.notes.startsWith('Redirected')) {
            result.verdict = 'url_redirected';
            return result;
        }

        result.verdict = 'ok';
        if (!result.notes) result.notes = 'URL alive + GG amount visible on page';
        return result;
    } catch (err) {
        result.fetch_error = (err as Error).message.slice(0, 200);
        result.verdict = 'fetch_failed';
        result.notes = `Fetch error: ${result.fetch_error}`;
        return result;
    }
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
    lines.push('# Data Quality Audit');
    lines.push('');
    lines.push(`*Generated: ${new Date().toISOString()}*`);
    lines.push(`*Products checked: ${results.length}*`);
    lines.push('');

    const counts: Record<string, number> = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;

    lines.push('## Verdict counts');
    lines.push('| Verdict | Count | % |');
    lines.push('|---|---|---|');
    for (const [v, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        lines.push(`| \`${v}\` | ${c} | ${((c / results.length) * 100).toFixed(0)}% |`);
    }
    lines.push('');

    const sections: Array<[string, string]> = [
        ['url_404', 'Dead URLs (404) — need replacement'],
        ['amount_mismatch', 'Amount mismatch — GG amount not visible on page'],
        ['url_redirected', 'URLs redirected — may point to wrong product'],
        ['url_403', 'Anti-bot blocks (URL may still be valid in browser)'],
        ['url_5xx', 'Server errors'],
        ['fetch_failed', 'Fetch failed (network/timeout)'],
    ];

    for (const [verdict, title] of sections) {
        const items = results.filter((r) => r.verdict === verdict);
        if (items.length === 0) continue;
        lines.push(`## ${title}`);
        lines.push('');
        lines.push('| Store | Product | GG amt | Sizes on page | URL |');
        lines.push('|---|---|---|---|---|');
        for (const r of items.slice(0, 80)) {
            const sizes = (r.page_sizes_found ?? []).slice(0, 4).join(', ') || '-';
            const url = r.url.length > 100 ? r.url.slice(0, 100) + '...' : r.url;
            lines.push(`| ${r.store} | ${r.name.slice(0, 45)} | ${r.gg_amount ?? '-'}g | ${sizes} | ${url} |`);
        }
        if (items.length > 80) lines.push(`| ... | ... | ... | ... | (${items.length - 80} more) |`);
        lines.push('');
    }

    return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

const concurrency = parseInt(process.argv.find((a) => a.startsWith('--c'))?.split('=')[1] ?? '6', 10);
const limit = parseInt(process.argv.find((a) => a.startsWith('--l'))?.split('=')[1] ?? '9999', 10);

console.log('[dq-audit] Fetching all enabled products...');
const all = await fetch(`${BACKEND_API}/products?type=MINIMAL`).then((r) => r.json()) as GgProduct[];
const pool = all.filter((p) => p.enabled && p.scrape_enabled && !p.out_of_stock && p.price > 0).slice(0, limit);
console.log(`[dq-audit] Auditing ${pool.length} products with concurrency=${concurrency}`);

const browser = await createBrowser();
const results = await runWithConcurrency(pool, concurrency, async (p, i) => {
    const r = await auditOne(p, browser);
    const flag = r.verdict === 'ok' ? '✓' : r.verdict === 'amount_mismatch' ? '⚠' : '✗';
    console.log(`[${i + 1}/${pool.length}] ${flag} ${r.store} | ${r.name.slice(0, 40)} | ${r.verdict} | ${r.notes.slice(0, 80)}`);
    return r;
});
await browser.close().catch(() => undefined);

await mkdir(REPORT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(resolve(REPORT_DIR, `dq-${ts}.json`), JSON.stringify(results, null, 2));
const md = buildReport(results);
await writeFile(resolve(REPORT_DIR, `dq-${ts}.md`), md);

console.log('');
console.log(`[dq-audit] Done. Reports in: ${REPORT_DIR}`);
console.log('');
console.log(md.split('## Dead URLs')[0]);
process.exit(0);
