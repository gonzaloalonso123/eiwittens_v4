// Auto-fix data quality issues found by data-quality-audit.
//
// For each problem product:
//   - amount_mismatch: fetch page, parse sizes, propose update_amount or delete
//   - url_404: try store-specific search (Shopify search endpoint or generic /search?q=)
//             to find a replacement URL. If nothing found, propose delete.
//
// Output: JSON migration plan + markdown report with confidence per fix.
// Apply with --apply (requires FIREBASE_CREDENTIALS).
//
// Run with:
//   pnpm tsx src/jobs/auto-fix-data-quality.ts            # dry run
//   pnpm tsx src/jobs/auto-fix-data-quality.ts -- --apply # write to Firestore

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowser } from '../scraper/driver.js';
import type { Browser } from 'playwright';

const BACKEND_API = 'https://eiwittens-backend-16129604687.europe-west4.run.app';
const DQ_REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'data-quality-reports');
const FIX_REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'auto-fix-reports');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
};

interface DqResult {
    productId: string;
    name: string;
    store: string;
    url: string;
    finalUrl?: string;
    gg_amount?: number;
    http_status?: number;
    page_sizes_found?: string[];
    verdict: string;
    notes: string;
}

type Confidence = 'high' | 'medium' | 'low';
type Action = 'update_amount' | 'refresh_url' | 'delete_product' | 'flag_review';

interface Fix {
    productId: string;
    name: string;
    store: string;
    issue: string;
    action: Action;
    confidence: Confidence;
    new_amount?: number;
    new_url?: string;
    reasoning: string;
    current_url: string;
    current_amount?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseSizeLabel(label: string): number | null {
    // Convert "1kg", "500g", "2,5kg", "300 gr" → grams
    const norm = label.toLowerCase().replace(/\s+/g, '');
    const m = norm.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gram)$/);
    if (!m) return null;
    const num = parseFloat(m[1].replace(',', '.'));
    const unit = m[2];
    if (unit === 'kg') return Math.round(num * 1000);
    return Math.round(num);
}

/**
 * Is this product sold as a count (capsules/tablets/stuks) rather than by weight?
 * For these, the GG `amount` field is the COUNT, not grams. Page size labels in
 * grams don't apply — comparing them is meaningless.
 */
function isCountProduct(name: string): boolean {
    return /\b(stuks?|caps?|capsules?|capsule|tabs?|tablets?|tablet|tabletten|pillen)\b/i.test(name);
}

/**
 * Is this product a multipack bundle? Names like "2x440g", "3x500g", "Voordeelpot | 2x450g".
 * For these the GG amount is the SUM (N × single). Page often shows the single-pack size
 * which would naively look like a mismatch.
 */
function detectMultipack(name: string): { isMultipack: boolean; nUnits?: number; perUnitGrams?: number } {
    const m = name.match(/(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|gram)/i);
    if (!m) return { isMultipack: false };
    const n = parseInt(m[1], 10);
    let per = parseFloat(m[2].replace(',', '.'));
    const unit = m[3].toLowerCase();
    if (unit === 'kg') per *= 1000;
    return { isMultipack: true, nUnits: n, perUnitGrams: Math.round(per) };
}

function pickClosestSize(ggAmount: number, pageSizes: string[]): { newAmount: number | null; confidence: Confidence; reasoning: string } {
    const candidates = pageSizes
        .map((s) => ({ label: s, grams: parseSizeLabel(s) }))
        .filter((c): c is { label: string; grams: number } => c.grams !== null && c.grams >= 50 && c.grams <= 50_000);

    if (candidates.length === 0) {
        return { newAmount: null, confidence: 'low', reasoning: 'No parseable size labels on page' };
    }

    // Pick closest by ratio
    candidates.sort((a, b) => Math.abs(a.grams - ggAmount) - Math.abs(b.grams - ggAmount));
    const closest = candidates[0];
    const ratio = Math.max(closest.grams, ggAmount) / Math.min(closest.grams, ggAmount);

    if (closest.grams === ggAmount) {
        return { newAmount: closest.grams, confidence: 'high', reasoning: `Exact match found on page (${closest.label})` };
    }
    if (ratio <= 1.25) {
        return { newAmount: closest.grams, confidence: 'high', reasoning: `Closest size ${closest.label} = ${closest.grams}g (Δ ${Math.round((ratio - 1) * 100)}%)` };
    }
    if (ratio <= 2) {
        return { newAmount: closest.grams, confidence: 'medium', reasoning: `Closest size ${closest.label} = ${closest.grams}g but ratio is ${ratio.toFixed(2)}× — could be a different pack tier` };
    }
    return { newAmount: closest.grams, confidence: 'low', reasoning: `Closest size ${closest.label} = ${closest.grams}g but ratio is ${ratio.toFixed(2)}× — likely needs manual review` };
}

// ── Amount mismatch fixer ────────────────────────────────────────────────────

function fixAmountMismatch(r: DqResult): Fix {
    const sizes = r.page_sizes_found ?? [];
    if (!r.gg_amount) {
        return {
            productId: r.productId, name: r.name, store: r.store,
            issue: 'amount_mismatch (no GG amount)',
            action: 'flag_review',
            confidence: 'low',
            reasoning: 'GG has no amount set',
            current_url: r.url,
            current_amount: r.gg_amount,
        };
    }

    // Count products (capsules/tablets): GG amount is a count, gram sizes don't apply
    if (isCountProduct(r.name)) {
        return {
            productId: r.productId, name: r.name, store: r.store,
            issue: 'amount_mismatch (count product)',
            action: 'flag_review',
            confidence: 'low',
            reasoning: `Product sold by count (capsules/tabs). GG amount=${r.gg_amount} is likely the count, not grams. Verify count matches page (page sizes: ${sizes.slice(0, 3).join(', ')})`,
            current_url: r.url,
            current_amount: r.gg_amount,
        };
    }

    // Multipack products (Nx pattern): GG amount is sum, page shows single
    const mp = detectMultipack(r.name);
    if (mp.isMultipack) {
        const expectedTotal = (mp.nUnits ?? 1) * (mp.perUnitGrams ?? 0);
        const perOnPage = sizes.find((s) => parseSizeLabel(s) === mp.perUnitGrams);
        if (perOnPage && r.gg_amount === expectedTotal) {
            // Page shows the single-pack size and GG already has the bundle total. All correct.
            return {
                productId: r.productId, name: r.name, store: r.store,
                issue: 'amount_mismatch (false positive: multipack)',
                action: 'flag_review',
                confidence: 'low',
                reasoning: `Multipack ${mp.nUnits}× ${mp.perUnitGrams}g = ${expectedTotal}g matches GG. Page shows single-pack size (${perOnPage}). GG data is correct — DQ audit false alarm.`,
                current_url: r.url,
                current_amount: r.gg_amount,
            };
        }
        return {
            productId: r.productId, name: r.name, store: r.store,
            issue: 'amount_mismatch (multipack)',
            action: 'flag_review',
            confidence: 'low',
            reasoning: `Multipack product (${mp.nUnits}× ${mp.perUnitGrams}g). Manual review: verify if site still sells this bundle.`,
            current_url: r.url,
            current_amount: r.gg_amount,
        };
    }

    const { newAmount, confidence, reasoning } = pickClosestSize(r.gg_amount, sizes);

    if (newAmount === null) {
        return {
            productId: r.productId, name: r.name, store: r.store,
            issue: 'amount_mismatch',
            action: 'flag_review',
            confidence: 'low',
            reasoning,
            current_url: r.url,
            current_amount: r.gg_amount,
        };
    }

    if (confidence === 'low') {
        return {
            productId: r.productId, name: r.name, store: r.store,
            issue: 'amount_mismatch',
            action: 'flag_review',
            confidence,
            reasoning,
            current_url: r.url,
            current_amount: r.gg_amount,
        };
    }

    return {
        productId: r.productId, name: r.name, store: r.store,
        issue: 'amount_mismatch',
        action: 'update_amount',
        confidence,
        new_amount: newAmount,
        reasoning,
        current_url: r.url,
        current_amount: r.gg_amount,
    };
}

// ── Dead URL fixer ───────────────────────────────────────────────────────────

function isShopifyStore(url: string): boolean {
    return /\/products\/[a-z0-9-]+/i.test(url);
}

function getStoreOrigin(url: string): string | null {
    try {
        // Strip awin tracking URL to get destination
        if (url.includes('awin1.com')) {
            const ued = new URL(url).searchParams.get('ued');
            if (ued) {
                const decoded = decodeURIComponent(ued);
                return new URL(decoded).origin;
            }
        }
        return new URL(url).origin;
    } catch {
        return null;
    }
}

async function trySearchShopify(origin: string, query: string): Promise<string | null> {
    try {
        const url = `${origin}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=5`;
        const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const data = await res.json() as { resources?: { results?: { products?: Array<{ url?: string; title?: string }> } } };
        const products = data?.resources?.results?.products ?? [];
        if (products.length === 0) return null;
        const first = products[0];
        if (!first.url) return null;
        return first.url.startsWith('http') ? first.url : `${origin}${first.url}`;
    } catch {
        return null;
    }
}

/**
 * Magento default search endpoint: /catalogsearch/result/?q=<query>.
 * Returns first matching product URL whose anchor text shares words with the query.
 */
async function trySearchMagento(origin: string, query: string, browser: Browser): Promise<string | null> {
    const url = `${origin}/catalogsearch/result/?q=${encodeURIComponent(query)}`;
    try {
        const context = await browser.newContext({ userAgent: HEADERS['User-Agent'], locale: 'nl-NL' });
        try {
            const page = await context.newPage();
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null);
            if (!response || response.status() >= 400) return null;
            await page.waitForTimeout(800);
            // Magento product cards typically have a.product-item-link or a[href*=".html"]
            const links = await page.locator('a.product-item-link, a[href*=".html"], a[href*="/product"]').all();
            const qWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
            for (const link of links.slice(0, 20)) {
                const href = await link.getAttribute('href').catch(() => null);
                const text = await link.innerText().catch(() => '');
                if (!href || !text) continue;
                const textLow = text.toLowerCase();
                const hits = qWords.filter((w) => textLow.includes(w)).length;
                if (hits >= Math.max(1, Math.floor(qWords.length / 2))) {
                    // Sanity: verify the link doesn't go to a category/non-product
                    if (/\/category|\/c\/|catalogsearch/i.test(href)) continue;
                    return href.startsWith('http') ? href : `${origin}${href}`;
                }
            }
            return null;
        } finally {
            await context.close().catch(() => undefined);
        }
    } catch {
        return null;
    }
}

async function tryGenericSearch(origin: string, query: string, brandHint: string, _browser: Browser): Promise<string | null> {
    const qWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const brandLow = brandHint.toLowerCase().replace(/\s+/g, '');
    const brandTokens = brandHint.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (qWords.length === 0) return null;

    const paths = [
        '/zoeken?q=', '/zoeken?search=',
        '/search?q=', '/search?search=',
        '/zoek?q=', '/zoek?term=',
        '/winkel/zoeken?q=',
    ];

    for (const p of paths) {
        const url = `${origin}${p}${encodeURIComponent(query)}`;
        try {
            const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
            if (!res.ok) continue;
            const html = await res.text();

            const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
            const candidates: Array<{ href: string; text: string }> = [];
            for (const m of html.matchAll(linkRe)) {
                const href = m[1];
                const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
                if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
                const looksLikeProduct = /\.html|\/product|\/p\/|\/products\//.test(href);
                const isCategoryOrNav = /\/category|\/c\/|catalogsearch|\/zoeken|\/search|\/cart|\/account|\/login/.test(href);
                if (!looksLikeProduct || isCategoryOrNav) continue;
                if (text.length < 5 || text.length > 200) continue;
                candidates.push({ href, text });
            }

            const scored = candidates.map((c) => {
                const hrefLow = c.href.toLowerCase();
                const textLow = c.text.toLowerCase();
                const both = `${hrefLow} ${textLow}`;
                const wordMatches = qWords.filter((w) => both.includes(w)).length;
                // CRITICAL: require brand to appear in href or text
                const brandMatch = both.includes(brandLow)
                    || brandTokens.some((t) => both.includes(t));
                return { ...c, score: wordMatches, brandMatch };
            }).filter((c) => c.score >= Math.max(1, Math.floor(qWords.length / 2)));

            // Only return candidates that ALSO match the brand — strict
            const branded = scored.filter((c) => c.brandMatch);
            branded.sort((a, b) => b.score - a.score);

            if (branded.length > 0) {
                const best = branded[0];
                return best.href.startsWith('http') ? best.href : `${origin}${best.href}`;
            }
        } catch {
            // try next path
        }
    }

    return null;
}

async function fixDeadUrl(r: DqResult, browser: Browser): Promise<Fix> {
    const origin = getStoreOrigin(r.url);
    if (!origin) {
        return {
            productId: r.productId, name: r.name, store: r.store,
            issue: 'url_404',
            action: 'flag_review',
            confidence: 'low',
            reasoning: 'Could not parse store origin from URL',
            current_url: r.url,
            current_amount: r.gg_amount,
        };
    }

    // Build clean query — strip size/amount info to broaden search
    const cleanName = r.name.replace(/\|.*$/, '').trim();

    // Strategy 1 — Shopify shops
    if (isShopifyStore(r.url) || /shopify/i.test(origin)) {
        const newUrl = await trySearchShopify(origin, cleanName);
        if (newUrl) {
            return {
                productId: r.productId, name: r.name, store: r.store,
                issue: 'url_404',
                action: 'refresh_url',
                confidence: 'medium',
                new_url: newUrl,
                reasoning: `Shopify search/suggest matched: ${newUrl}`,
                current_url: r.url,
                current_amount: r.gg_amount,
            };
        }
    }

    // Strategy 2 — Magento shops (body-supplies.nl pattern)
    const magentoUrl = await trySearchMagento(origin, cleanName, browser);
    if (magentoUrl) {
        return {
            productId: r.productId, name: r.name, store: r.store,
            issue: 'url_404',
            action: 'refresh_url',
            confidence: 'medium',
            new_url: magentoUrl,
            reasoning: `Magento catalogsearch matched: ${magentoUrl}`,
            current_url: r.url,
            current_amount: r.gg_amount,
        };
    }

    // Strategy 3 — generic site search WITH brand filter
    const newUrl = await tryGenericSearch(origin, cleanName, r.store, browser);
    if (newUrl) {
        return {
            productId: r.productId, name: r.name, store: r.store,
            issue: 'url_404',
            action: 'refresh_url',
            confidence: 'medium',
            new_url: newUrl,
            reasoning: `Site search found brand-matched product: ${newUrl}`,
            current_url: r.url,
            current_amount: r.gg_amount,
        };
    }

    return {
        productId: r.productId, name: r.name, store: r.store,
        issue: 'url_404',
        action: 'delete_product',
        confidence: 'medium',
        reasoning: 'No replacement URL found via Shopify/Magento/site search. Product likely discontinued.',
        current_url: r.url,
        current_amount: r.gg_amount,
    };
}

// ── Apply to Firestore ───────────────────────────────────────────────────────

async function applyFixes(fixes: Fix[], minConfidence: Confidence): Promise<void> {
    const { db } = await import('../db/firebase.js');
    const collection = db.collection('products');

    const order = { high: 3, medium: 2, low: 1 };
    const threshold = order[minConfidence];

    let updated = 0;
    let deleted = 0;
    let skipped = 0;

    for (const fix of fixes) {
        if (order[fix.confidence] < threshold) {
            skipped++;
            continue;
        }
        try {
            if (fix.action === 'update_amount' && fix.new_amount) {
                await collection.doc(fix.productId).update({ amount: fix.new_amount });
                console.log(`  ✓ update_amount: ${fix.store} | ${fix.name.slice(0, 50)} | ${fix.current_amount}g → ${fix.new_amount}g`);
                updated++;
            } else if (fix.action === 'refresh_url' && fix.new_url) {
                await collection.doc(fix.productId).update({ url: fix.new_url });
                console.log(`  ✓ refresh_url: ${fix.store} | ${fix.name.slice(0, 50)} → ${fix.new_url.slice(0, 80)}`);
                updated++;
            } else if (fix.action === 'delete_product') {
                await collection.doc(fix.productId).update({ enabled: false, scrape_enabled: false, out_of_stock: true });
                console.log(`  ✓ disabled: ${fix.store} | ${fix.name.slice(0, 50)}`);
                deleted++;
            } else {
                skipped++;
            }
        } catch (err) {
            console.error(`  ✗ ${fix.name}: ${(err as Error).message}`);
        }
    }
    console.log('');
    console.log(`[apply] updated=${updated} disabled=${deleted} skipped=${skipped}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const apply = process.argv.includes('--apply');
const minConf: Confidence = process.argv.includes('--high-only') ? 'high'
    : process.argv.includes('--include-low') ? 'low'
    : 'medium';

console.log(`[auto-fix] Mode: ${apply ? `APPLY (min confidence: ${minConf})` : 'DRY RUN'}`);

// Load latest DQ audit
const dqFiles = (await readdir(DQ_REPORT_DIR)).filter((f) => f.endsWith('.json')).sort();
if (dqFiles.length === 0) {
    console.error(`No DQ audit reports in ${DQ_REPORT_DIR}. Run data-quality-audit first.`);
    process.exit(1);
}
const dqData = JSON.parse(await readFile(resolve(DQ_REPORT_DIR, dqFiles[dqFiles.length - 1]), 'utf-8')) as DqResult[];
console.log(`[auto-fix] Loaded ${dqData.length} DQ results from ${dqFiles[dqFiles.length - 1]}`);

// Filter to problem cases we can fix
const amountMismatches = dqData.filter((r) => r.verdict === 'amount_mismatch');
const deadUrls = dqData.filter((r) => r.verdict === 'url_404');
console.log(`[auto-fix] To process: ${amountMismatches.length} amount mismatches + ${deadUrls.length} dead URLs`);

// Pass 1: Amount mismatches (no network needed — already have sizes from DQ audit)
console.log('');
console.log('[auto-fix] Pass 1 — amount mismatches...');
const amountFixes: Fix[] = amountMismatches.map(fixAmountMismatch);

// Pass 2: Dead URLs (needs network — Shopify search + Playwright fallback)
console.log('[auto-fix] Pass 2 — dead URLs (this takes a few minutes)...');
const browser = await createBrowser();
const urlFixes: Fix[] = [];
let i = 0;
for (const r of deadUrls) {
    i++;
    const fix = await fixDeadUrl(r, browser);
    urlFixes.push(fix);
    console.log(`  [${i}/${deadUrls.length}] ${fix.store} | ${fix.name.slice(0, 40)} → ${fix.action} (${fix.confidence})`);
}
await browser.close().catch(() => undefined);

const allFixes = [...amountFixes, ...urlFixes];

// Build report
await mkdir(FIX_REPORT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(resolve(FIX_REPORT_DIR, `auto-fix-${ts}.json`), JSON.stringify(allFixes, null, 2));

const lines: string[] = [];
lines.push('# Auto-Fix Data Quality Plan');
lines.push('');
lines.push(`*Generated: ${new Date().toISOString()}*`);
lines.push(`*Total fixes: ${allFixes.length} | amount=${amountFixes.length}, url=${urlFixes.length}*`);
lines.push('');

const byAction: Record<string, Fix[]> = { update_amount: [], refresh_url: [], delete_product: [], flag_review: [] };
for (const f of allFixes) byAction[f.action].push(f);

const byConfidence: Record<string, Fix[]> = { high: [], medium: [], low: [] };
for (const f of allFixes) byConfidence[f.confidence].push(f);

lines.push('## Summary');
lines.push('');
lines.push('| Action | High | Medium | Low | Total |');
lines.push('|---|---|---|---|---|');
for (const action of ['update_amount', 'refresh_url', 'delete_product', 'flag_review']) {
    const items = byAction[action];
    const h = items.filter((f) => f.confidence === 'high').length;
    const m = items.filter((f) => f.confidence === 'medium').length;
    const l = items.filter((f) => f.confidence === 'low').length;
    lines.push(`| \`${action}\` | ${h} | ${m} | ${l} | ${items.length} |`);
}
lines.push('');

for (const action of ['update_amount', 'refresh_url', 'delete_product', 'flag_review'] as const) {
    const items = byAction[action];
    if (items.length === 0) continue;
    lines.push(`## ${action} (${items.length})`);
    lines.push('');
    if (action === 'update_amount') {
        lines.push('| Conf | Store | Product | Old amount | New amount | Reason |');
        lines.push('|---|---|---|---|---|---|');
        for (const f of items.sort((a, b) => (a.confidence < b.confidence ? 1 : -1))) {
            lines.push(`| ${f.confidence} | ${f.store} | ${f.name.slice(0, 40)} | ${f.current_amount}g | ${f.new_amount}g | ${f.reasoning.slice(0, 60)} |`);
        }
    } else if (action === 'refresh_url') {
        lines.push('| Conf | Store | Product | New URL | Reason |');
        lines.push('|---|---|---|---|---|');
        for (const f of items.sort((a, b) => (a.confidence < b.confidence ? 1 : -1))) {
            lines.push(`| ${f.confidence} | ${f.store} | ${f.name.slice(0, 40)} | ${f.new_url?.slice(0, 80)} | ${f.reasoning.slice(0, 50)} |`);
        }
    } else {
        lines.push('| Conf | Store | Product | URL | Reason |');
        lines.push('|---|---|---|---|---|');
        for (const f of items.sort((a, b) => (a.confidence < b.confidence ? 1 : -1))) {
            lines.push(`| ${f.confidence} | ${f.store} | ${f.name.slice(0, 40)} | ${f.current_url.slice(0, 80)} | ${f.reasoning.slice(0, 50)} |`);
        }
    }
    lines.push('');
}

const md = lines.join('\n');
await writeFile(resolve(FIX_REPORT_DIR, `auto-fix-${ts}.md`), md);

console.log('');
console.log(`[auto-fix] Report: ${resolve(FIX_REPORT_DIR, `auto-fix-${ts}.md`)}`);
console.log('');
console.log(md.split('## update_amount')[0]);

if (apply) {
    if (!process.env.FIREBASE_CREDENTIALS) {
        console.error('[apply] FIREBASE_CREDENTIALS not set. Cannot apply.');
        process.exit(1);
    }
    console.log(`[apply] Applying fixes with min confidence: ${minConf}`);
    await applyFixes(allFixes, minConf);
}

process.exit(0);
