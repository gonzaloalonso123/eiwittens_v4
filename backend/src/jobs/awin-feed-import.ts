// Local-only Awin feed importer for MyProtein.
//
// Downloads the gzipped CSV feed, parses it, matches each row against
// GierigGroeien's MyProtein products, and writes a DIFF JSON + markdown
// report. Does NOT write to Firestore — that's a manual step the user
// reviews first.
//
// Run with:
//   pnpm tsx src/jobs/awin-feed-import.ts -- --store MyProtein
//
// Env required:
//   AWIN_FEED_MYPROTEIN_URL (full URL incl. apikey)

import { configDotenv } from 'dotenv';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

configDotenv();

const BACKEND_API = 'https://eiwittens-backend-16129604687.europe-west4.run.app';
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'awin-import-reports');

interface FeedRow {
    aw_deep_link: string;
    product_name: string;
    aw_product_id: string;
    merchant_product_id: string;
    merchant_image_url: string;
    search_price: string;
    currency: string;
    store_price: string;
    merchant_deep_link: string;
    last_updated: string;
    display_price: string;
    brand_name: string;
    rrp_price: string;
    saving: string;
    in_stock: string;
    is_for_sale: string;
    [key: string]: string;
}

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

interface MatchResult {
    gg_id: string;
    gg_name: string;
    gg_url: string;
    gg_price: number;
    gg_amount?: number;

    match_strategy: 'merchant_product_id' | 'aw_product_id' | 'url_substring' | 'name_fuzzy' | 'none';
    feed_row?: FeedRow;
    feed_price?: number;
    feed_rrp?: number;
    feed_in_stock?: boolean;

    price_drift_pct?: number;
    verdict: 'match_agree' | 'match_drift' | 'match_oos' | 'no_match';
}

// ── CSV parsing — handle quoted fields with embedded commas ─────────────────

function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let i = 0;
    let cur = '';
    let inQuotes = false;

    while (i < line.length) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i += 2;
                } else {
                    inQuotes = false;
                    i++;
                }
            } else {
                cur += c;
                i++;
            }
        } else {
            if (c === ',') {
                out.push(cur);
                cur = '';
                i++;
            } else if (c === '"' && cur === '') {
                inQuotes = true;
                i++;
            } else {
                cur += c;
                i++;
            }
        }
    }
    out.push(cur);
    return out;
}

async function downloadAndParseFeed(url: string): Promise<FeedRow[]> {
    console.log('[awin] Downloading feed...');
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Feed download failed: ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    const csv = gunzipSync(buf).toString('utf-8');

    console.log(`[awin] Parsing CSV (${(csv.length / 1024 / 1024).toFixed(1)} MB)...`);

    const lines = csv.split('\n');
    const header = parseCsvLine(lines[0]);
    const rows: FeedRow[] = [];

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = parseCsvLine(lines[i]);
        const row: Record<string, string> = {};
        for (let j = 0; j < header.length; j++) {
            row[header[j]] = values[j] ?? '';
        }
        rows.push(row as FeedRow);
    }

    console.log(`[awin] Loaded ${rows.length} feed rows`);
    return rows;
}

async function fetchGgMyProteinProducts(): Promise<GgProduct[]> {
    const res = await fetch(`${BACKEND_API}/products?type=MINIMAL`);
    if (!res.ok) throw new Error(`GG API failed: ${res.status}`);
    const all = await res.json() as GgProduct[];
    return all.filter((p) => p.store === 'MyProtein' && p.enabled && p.scrape_enabled);
}

// ── Matching strategies ─────────────────────────────────────────────────────

function extractMyProteinProductIdFromUrl(url: string): string | null {
    // Awin tracked URL: https://www.awin1.com/cread.php?...&ued=https%3A%2F%2Fnl.myprotein.com%2Fp%2F...%2F<digits>%2F
    // Direct URL:       https://nl.myprotein.com/p/.../10485166/...
    try {
        const decoded = decodeURIComponent(url);
        // Find /<digits>/ pattern near "myprotein"
        const myproteinSlice = decoded.split('myprotein.com')[1];
        if (!myproteinSlice) return null;
        const m = myproteinSlice.match(/\/(\d{4,12})\b/);
        return m?.[1] ?? null;
    } catch {
        return null;
    }
}

function extractMasterProductIdFromDeepLink(deepLink: string): string | null {
    const m = deepLink.match(/myprotein\.com\/p\/[^/]+\/[^/]+\/(\d+)/);
    return m?.[1] ?? null;
}

function amountToSizeStrings(grams: number | undefined): string[] {
    if (!grams || !isFinite(grams) || grams <= 0) return [];
    const out: string[] = [];
    out.push(`${grams}g`);
    out.push(`${grams} g`);
    if (grams >= 1000) {
        const kg = grams / 1000;
        const kgDot = kg % 1 === 0 ? String(kg) : String(parseFloat(kg.toFixed(2)));
        const kgComma = kgDot.replace('.', ',');
        for (const v of new Set([kgDot, kgComma])) {
            out.push(`${v}kg`);
            out.push(`${v} kg`);
        }
    }
    // Also handle "stuks" / "tablets" / "capsules" via numeric prefix
    out.push(`${grams}stuks`);
    out.push(`${grams} stuks`);
    out.push(`${grams}tablets`);
    out.push(`${grams}capsules`);
    return out;
}

function feedNameMatchesSize(feedName: string, sizeStrings: string[]): boolean {
    const lower = feedName.toLowerCase();
    return sizeStrings.some((s) => lower.includes(s.toLowerCase()));
}

function extractAwinProductIdFromUrl(url: string): string | null {
    // pclick.php?p=<aw_product_id>&...
    const m = url.match(/[?&]p=(\d{6,15})/);
    return m?.[1] ?? null;
}

function normalizeName(s: string): string {
    return s.toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function matchProduct(product: GgProduct, feedById: Map<string, FeedRow>, feedByAwId: Map<string, FeedRow>, feedRowsByMaster: Map<string, FeedRow[]>, feedRows: FeedRow[]): MatchResult {
    const result: MatchResult = {
        gg_id: product.id,
        gg_name: product.name,
        gg_url: product.url,
        gg_price: product.price,
        gg_amount: product.amount,
        match_strategy: 'none',
        verdict: 'no_match',
    };

    const sizeStrings = amountToSizeStrings(product.amount);
    const masterId = extractMyProteinProductIdFromUrl(product.url);

    // 1. Best path: master product ID + size match → unique variant
    if (masterId && feedRowsByMaster.has(masterId)) {
        const candidates = feedRowsByMaster.get(masterId)!;
        if (sizeStrings.length > 0) {
            const sized = candidates.filter((r) => feedNameMatchesSize(r.product_name, sizeStrings));
            if (sized.length === 1) {
                result.feed_row = sized[0];
                result.match_strategy = 'merchant_product_id';
            } else if (sized.length > 1) {
                // Multiple variants with same size (different flavors) — pick cheapest (default)
                sized.sort((a, b) => parseFloat(a.search_price || '999') - parseFloat(b.search_price || '999'));
                result.feed_row = sized[0];
                result.match_strategy = 'merchant_product_id';
            }
        }
        // No size info or no size match: pick cheapest variant in master group
        if (!result.feed_row) {
            const sorted = [...candidates].sort((a, b) => parseFloat(a.search_price || '999') - parseFloat(b.search_price || '999'));
            if (sorted.length > 0) {
                result.feed_row = sorted[0];
                result.match_strategy = 'url_substring';
            }
        }
    }

    // 2. Awin product ID fallback (rare — only if URL was a direct pclick.php)
    if (!result.feed_row) {
        const awId = extractAwinProductIdFromUrl(product.url);
        if (awId && feedByAwId.has(awId)) {
            result.feed_row = feedByAwId.get(awId);
            result.match_strategy = 'aw_product_id';
        }
    }

    // 3. Fuzzy name match — last resort
    if (!result.feed_row) {
        const norm = normalizeName(product.name);
        const candidates = feedRows.filter((r) => {
            const feedNorm = normalizeName(r.product_name);
            return feedNorm.includes(norm) || norm.includes(feedNorm);
        });
        if (sizeStrings.length > 0) {
            const sized = candidates.filter((r) => feedNameMatchesSize(r.product_name, sizeStrings));
            if (sized.length > 0) {
                result.feed_row = sized[0];
                result.match_strategy = 'name_fuzzy';
            }
        }
        if (!result.feed_row && candidates.length > 0) {
            result.feed_row = candidates[0];
            result.match_strategy = 'name_fuzzy';
        }
    }

    if (!result.feed_row) {
        result.verdict = 'no_match';
        return result;
    }

    const row = result.feed_row;
    const feedPrice = parseFloat(row.search_price || row.store_price || '0');
    const feedRrp = parseFloat(row.rrp_price || '0');
    const inStock = row.in_stock === '1' || row.in_stock === 'true' || row.is_for_sale === '1';

    result.feed_price = feedPrice;
    result.feed_rrp = feedRrp || undefined;
    result.feed_in_stock = inStock;

    if (!inStock) {
        result.verdict = 'match_oos';
    } else if (feedPrice > 0 && product.price > 0) {
        const drift = Math.abs(feedPrice - product.price) / Math.max(feedPrice, product.price);
        result.price_drift_pct = drift * 100;
        result.verdict = drift < 0.01 ? 'match_agree' : 'match_drift';
    }

    return result;
}

// ── Report ──────────────────────────────────────────────────────────────────

function summarize(matches: MatchResult[], feedSize: number): string {
    const lines: string[] = [];
    lines.push('# Awin MyProtein Feed Import Report');
    lines.push('');
    lines.push(`*Generated: ${new Date().toISOString()}*`);
    lines.push(`*Feed size: ${feedSize} products | GG MyProtein products: ${matches.length}*`);
    lines.push('');

    const verdictCounts: Record<string, number> = {};
    const strategyCounts: Record<string, number> = {};
    for (const m of matches) {
        verdictCounts[m.verdict] = (verdictCounts[m.verdict] ?? 0) + 1;
        strategyCounts[m.match_strategy] = (strategyCounts[m.match_strategy] ?? 0) + 1;
    }

    lines.push('## Verdict counts');
    lines.push('');
    lines.push('| Verdict | Count | % |');
    lines.push('|---|---|---|');
    for (const [v, c] of Object.entries(verdictCounts).sort((a, b) => b[1] - a[1])) {
        lines.push(`| \`${v}\` | ${c} | ${((c / matches.length) * 100).toFixed(1)}% |`);
    }
    lines.push('');
    lines.push('- `match_agree` — feed price matches current GG price (< 1% diff). Safe to switch.');
    lines.push('- `match_drift` — feed price differs from current GG price. **Most interesting** — feed may be more up-to-date.');
    lines.push('- `match_oos` — feed says out of stock.');
    lines.push('- `no_match` — could not match this GG product to any feed row.');
    lines.push('');

    lines.push('## Match strategy distribution');
    lines.push('');
    lines.push('| Strategy | Count |');
    lines.push('|---|---|');
    for (const [s, c] of Object.entries(strategyCounts).sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${s} | ${c} |`);
    }
    lines.push('');

    const drifts = matches.filter((m) => m.verdict === 'match_drift').sort((a, b) => (b.price_drift_pct ?? 0) - (a.price_drift_pct ?? 0));
    if (drifts.length) {
        lines.push('## Price drifts (feed disagrees with current GG price)');
        lines.push('');
        lines.push('| GG name | GG price | Feed price | Feed RRP | Drift % | Strategy |');
        lines.push('|---|---|---|---|---|---|');
        for (const m of drifts) {
            lines.push(`| ${m.gg_name.slice(0, 45)} | €${m.gg_price} | €${m.feed_price?.toFixed(2)} | €${m.feed_rrp?.toFixed(2) ?? '-'} | ${m.price_drift_pct?.toFixed(1)}% | ${m.match_strategy} |`);
        }
        lines.push('');
    }

    const noMatch = matches.filter((m) => m.verdict === 'no_match');
    if (noMatch.length) {
        lines.push('## Unmatched products');
        lines.push('');
        lines.push('| GG name | URL |');
        lines.push('|---|---|');
        for (const m of noMatch.slice(0, 50)) {
            lines.push(`| ${m.gg_name.slice(0, 60)} | [link](${m.gg_url.slice(0, 80)}...) |`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

const feedUrl = process.env.AWIN_FEED_MYPROTEIN_URL;
if (!feedUrl) {
    console.error('AWIN_FEED_MYPROTEIN_URL is not set in backend/.env');
    process.exit(1);
}

const feedRows = await downloadAndParseFeed(feedUrl);

// Build lookup maps
const feedByMpId = new Map<string, FeedRow>();
const feedByAwId = new Map<string, FeedRow>();
const feedRowsByMaster = new Map<string, FeedRow[]>();
for (const row of feedRows) {
    if (row.merchant_product_id) feedByMpId.set(row.merchant_product_id, row);
    if (row.aw_product_id) feedByAwId.set(row.aw_product_id, row);
    const master = extractMasterProductIdFromDeepLink(row.merchant_deep_link);
    if (master) {
        const arr = feedRowsByMaster.get(master) ?? [];
        arr.push(row);
        feedRowsByMaster.set(master, arr);
    }
}

const ggProducts = await fetchGgMyProteinProducts();
console.log(`[awin] Fetched ${ggProducts.length} MyProtein products from GG`);

const matches = ggProducts.map((p) => matchProduct(p, feedByMpId, feedByAwId, feedRowsByMaster, feedRows));

await mkdir(REPORT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const jsonPath = resolve(REPORT_DIR, `awin-import-${ts}.json`);
const mdPath = resolve(REPORT_DIR, `awin-import-${ts}.md`);

await writeFile(jsonPath, JSON.stringify({ feed_size: feedRows.length, matches }, null, 2));
const md = summarize(matches, feedRows.length);
await writeFile(mdPath, md);

console.log('');
console.log(`[awin] Done. Reports:`);
console.log(`  JSON: ${jsonPath}`);
console.log(`  MD:   ${mdPath}`);
console.log('');
console.log(md.split('## Match strategy distribution')[0]);

process.exit(0);
