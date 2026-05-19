// One-time shop capability audit: for each unique store in GG, check whether
// the product page exposes price data via:
//   1. JSON-LD Product schema (offers.price)
//   2. OpenGraph product meta tags (product:price:amount)
//   3. Microdata (itemprop="price")
//   4. Shopify products.json endpoint (/products/<handle>.json)
//
// Output: per-store table showing which "free" extraction methods work.
// Stores that support any of these never need to be scraped with Playwright
// or AI — direct HTTP + parse is 100% reliable.
//
// Run with:
//   pnpm tsx src/jobs/shop-capability-audit.ts -- --concurrency 8

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_API = 'https://eiwittens-backend-16129604687.europe-west4.run.app';
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'capability-reports');

interface GgProduct {
    id: string;
    name: string;
    store: string;
    url: string;
    price: number;
    enabled: boolean;
    scrape_enabled: boolean;
    out_of_stock: boolean;
}

interface StoreCapability {
    store: string;
    product_count: number;
    sampled_product_id: string;
    sampled_product_name: string;
    sampled_url: string;
    final_url?: string;

    http_ok: boolean;
    http_status?: number;
    fetch_error?: string;

    // Capability detection
    has_jsonld_product: boolean;
    jsonld_price?: number;
    jsonld_currency?: string;
    jsonld_availability?: string;

    has_og_price: boolean;
    og_price?: number;
    og_currency?: string;

    has_microdata_price: boolean;
    microdata_price?: number;

    is_shopify: boolean;
    shopify_json_ok?: boolean;
    shopify_price?: number;

    // Reference: what does GG currently think this product costs?
    gg_price: number;

    // Summary
    best_method: 'jsonld' | 'shopify_json' | 'og' | 'microdata' | 'none';
    method_price?: number;
    matches_gg: boolean;
    drift_pct?: number;
}

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
};

async function fetchAllProducts(): Promise<GgProduct[]> {
    const res = await fetch(`${BACKEND_API}/products?type=MINIMAL`);
    return await res.json() as GgProduct[];
}

function pickPerStore(products: GgProduct[]): Map<string, GgProduct[]> {
    const byStore = new Map<string, GgProduct[]>();
    for (const p of products) {
        if (!p.enabled || !p.scrape_enabled || p.out_of_stock || p.price <= 0) continue;
        const arr = byStore.get(p.store) ?? [];
        arr.push(p);
        byStore.set(p.store, arr);
    }
    return byStore;
}

function priceFromText(text: unknown): number | undefined {
    if (text === null || text === undefined) return undefined;
    const s = String(text).replace(/[€£$\s]/g, '').replace(/[^\d.,]/g, '');
    if (!s) return undefined;
    // EU format with comma decimal
    const isEu = /\d+,\d+$/.test(s);
    const cleaned = isEu ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

function detectJsonLd(html: string): { found: boolean; price?: number; currency?: string; availability?: string } {
    // Find all <script type="application/ld+json">...</script>
    const scripts = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of scripts) {
        try {
            const data = JSON.parse(m[1].trim());
            const result = walkJsonLd(data);
            if (result) return { found: true, ...result };
        } catch {
            // ignore malformed
        }
    }
    return { found: false };
}

function walkJsonLd(node: unknown): { price?: number; currency?: string; availability?: string } | null {
    if (!node) return null;
    if (Array.isArray(node)) {
        for (const item of node) {
            const r = walkJsonLd(item);
            if (r) return r;
        }
        return null;
    }
    if (typeof node !== 'object') return null;
    const obj = node as Record<string, unknown>;

    // Check @graph
    if (Array.isArray(obj['@graph'])) {
        const r = walkJsonLd(obj['@graph']);
        if (r) return r;
    }

    // Is this a Product?
    const type = obj['@type'];
    const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
    if (isProduct && obj.offers) {
        const offer = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
        if (offer && typeof offer === 'object') {
            const o = offer as Record<string, unknown>;
            const price = priceFromText(o.price ?? o.lowPrice ?? (o.priceSpecification as Record<string, unknown>)?.price);
            const currency = (o.priceCurrency as string) ?? 'EUR';
            const availability = (o.availability as string) ?? undefined;
            if (price !== undefined) return { price, currency, availability };
        }
    }

    return null;
}

function detectOgPrice(html: string): { found: boolean; price?: number; currency?: string } {
    const priceMatch = html.match(/<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i)
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:price:amount["']/i);
    const currencyMatch = html.match(/<meta[^>]+property=["']product:price:currency["'][^>]+content=["']([^"']+)["']/i)
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:price:currency["']/i);
    if (priceMatch) {
        return { found: true, price: priceFromText(priceMatch[1]), currency: currencyMatch?.[1] };
    }
    return { found: false };
}

function detectMicrodataPrice(html: string): { found: boolean; price?: number } {
    // <meta itemprop="price" content="X"> or <span itemprop="price">X</span>
    const metaMatch = html.match(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i)
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']price["']/i);
    if (metaMatch) {
        return { found: true, price: priceFromText(metaMatch[1]) };
    }
    const spanMatch = html.match(/<[a-z]+[^>]+itemprop=["']price["'][^>]*>([^<]+)</i);
    if (spanMatch) {
        return { found: true, price: priceFromText(spanMatch[1]) };
    }
    return { found: false };
}

function isShopifyUrl(url: string): boolean {
    return /\/products\/[a-z0-9-]+/i.test(url);
}

function buildShopifyJsonUrl(url: string): string | null {
    const m = url.match(/^(https?:\/\/[^/]+)\/products\/([a-z0-9-]+)/i);
    if (!m) return null;
    return `${m[1]}/products/${m[2]}.json`;
}

async function checkShopify(url: string): Promise<{ ok: boolean; price?: number }> {
    const jsonUrl = buildShopifyJsonUrl(url);
    if (!jsonUrl) return { ok: false };
    try {
        const res = await fetch(jsonUrl, { headers: HEADERS, redirect: 'follow' });
        if (!res.ok) return { ok: false };
        const data = await res.json() as { product?: { variants?: Array<{ price?: string }> } };
        if (!data?.product?.variants) return { ok: false };
        const variants = data.product.variants;
        const prices = variants.map((v) => parseFloat(v.price ?? '0')).filter((p) => p > 0);
        if (prices.length === 0) return { ok: false };
        return { ok: true, price: prices[0] };
    } catch {
        return { ok: false };
    }
}

async function auditOne(product: GgProduct, allProducts: GgProduct[]): Promise<StoreCapability> {
    const productCount = allProducts.filter((p) => p.store === product.store).length;
    const cap: StoreCapability = {
        store: product.store,
        product_count: productCount,
        sampled_product_id: product.id,
        sampled_product_name: product.name,
        sampled_url: product.url,
        http_ok: false,
        has_jsonld_product: false,
        has_og_price: false,
        has_microdata_price: false,
        is_shopify: false,
        gg_price: product.price,
        best_method: 'none',
        matches_gg: false,
    };

    let html = '';
    let finalUrl = product.url;
    try {
        const res = await fetch(product.url, {
            headers: HEADERS,
            redirect: 'follow',
            signal: AbortSignal.timeout(20_000),
        });
        cap.http_status = res.status;
        cap.http_ok = res.ok;
        finalUrl = res.url;
        cap.final_url = finalUrl;
        if (!res.ok) {
            cap.fetch_error = `HTTP ${res.status}`;
            return cap;
        }
        html = await res.text();
    } catch (err) {
        cap.fetch_error = (err as Error).message.slice(0, 200);
        return cap;
    }

    // 1. JSON-LD
    const jsonld = detectJsonLd(html);
    cap.has_jsonld_product = jsonld.found;
    if (jsonld.found) {
        cap.jsonld_price = jsonld.price;
        cap.jsonld_currency = jsonld.currency;
        cap.jsonld_availability = jsonld.availability;
    }

    // 2. OpenGraph
    const og = detectOgPrice(html);
    cap.has_og_price = og.found;
    if (og.found) {
        cap.og_price = og.price;
        cap.og_currency = og.currency;
    }

    // 3. Microdata
    const md = detectMicrodataPrice(html);
    cap.has_microdata_price = md.found;
    if (md.found) cap.microdata_price = md.price;

    // 4. Shopify (try the final URL after redirects, since Awin links resolve to shop)
    cap.is_shopify = isShopifyUrl(finalUrl);
    if (cap.is_shopify) {
        const shopify = await checkShopify(finalUrl);
        cap.shopify_json_ok = shopify.ok;
        if (shopify.ok) cap.shopify_price = shopify.price;
    }

    // Pick best method (prefer most reliable in order)
    if (cap.shopify_json_ok && cap.shopify_price) {
        cap.best_method = 'shopify_json';
        cap.method_price = cap.shopify_price;
    } else if (cap.has_jsonld_product && cap.jsonld_price) {
        cap.best_method = 'jsonld';
        cap.method_price = cap.jsonld_price;
    } else if (cap.has_og_price && cap.og_price) {
        cap.best_method = 'og';
        cap.method_price = cap.og_price;
    } else if (cap.has_microdata_price && cap.microdata_price) {
        cap.best_method = 'microdata';
        cap.method_price = cap.microdata_price;
    }

    if (cap.method_price !== undefined && cap.gg_price > 0) {
        const drift = Math.abs(cap.method_price - cap.gg_price) / Math.max(cap.method_price, cap.gg_price);
        cap.drift_pct = drift * 100;
        cap.matches_gg = drift < 0.05;
    }

    return cap;
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < items.length) {
            const i = next++;
            const r = await worker(items[i]);
            results.push(r);
            console.log(`[${i + 1}/${items.length}] done`);
        }
    }));
    return results;
}

// ── Main ───────────────────────────────────────────────────────────────────

const concurrency = parseInt(process.argv.find((a) => a.startsWith('--c'))?.split('=')[1] ?? '8', 10);

const all = await fetchAllProducts();
console.log(`[audit] Total products: ${all.length}`);
const byStore = pickPerStore(all);
console.log(`[audit] Unique stores: ${byStore.size}`);

// Pick one sample product per store (cheapest = most likely to be a "real" product, not a bundle)
const samples: GgProduct[] = [];
for (const [, arr] of byStore) {
    // Sort by price asc, take the cheapest as sample
    const sorted = [...arr].sort((a, b) => a.price - b.price);
    samples.push(sorted[0]);
}
console.log(`[audit] Auditing ${samples.length} stores with concurrency=${concurrency}`);

const capabilities = await runWithConcurrency(samples, concurrency, (p) => auditOne(p, all));

capabilities.sort((a, b) => b.product_count - a.product_count);

await mkdir(REPORT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const jsonPath = resolve(REPORT_DIR, `capability-${ts}.json`);
const mdPath = resolve(REPORT_DIR, `capability-${ts}.md`);

await writeFile(jsonPath, JSON.stringify(capabilities, null, 2));

// Build report
const lines: string[] = [];
lines.push('# Shop Capability Audit');
lines.push('');
lines.push(`*Generated: ${new Date().toISOString()}*`);
lines.push(`*Stores audited: ${capabilities.length} | Total products covered: ${capabilities.reduce((s, c) => s + c.product_count, 0)}*`);
lines.push('');

const methodCounts: Record<string, number> = {};
const productsByMethod: Record<string, number> = {};
for (const c of capabilities) {
    methodCounts[c.best_method] = (methodCounts[c.best_method] ?? 0) + 1;
    productsByMethod[c.best_method] = (productsByMethod[c.best_method] ?? 0) + c.product_count;
}

lines.push('## Best free extraction method per store');
lines.push('');
lines.push('| Method | Stores | Products covered |');
lines.push('|---|---|---|');
for (const [m, c] of Object.entries(methodCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${m}\` | ${c} | ${productsByMethod[m]} |`);
}
lines.push('');
lines.push('**Method definitions** (in order of reliability):');
lines.push('- `shopify_json` — Shopify `/products/{handle}.json` endpoint. Most reliable, structured, includes all variants.');
lines.push('- `jsonld` — Schema.org Product JSON-LD `offers.price`. Industry-standard structured data.');
lines.push('- `og` — OpenGraph `product:price:amount` meta tag.');
lines.push('- `microdata` — Inline `itemprop="price"` attribute.');
lines.push('- `none` — None of the above worked. Must scrape with Playwright + AI.');
lines.push('');

// Per-store details, ranked by product count
lines.push('## Per-store capability matrix (ranked by product count)');
lines.push('');
lines.push('| Store | # Prods | JSON-LD | OG | Microdata | Shopify | Best | Method price | GG price | Drift% | HTTP |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of capabilities) {
    const yn = (b: boolean): string => b ? '✓' : '·';
    const fmt = (n: number | undefined): string => n !== undefined ? `€${n.toFixed(2)}` : '-';
    const drift = c.drift_pct !== undefined ? `${c.drift_pct.toFixed(1)}%` : '-';
    const http = c.http_ok ? `${c.http_status}` : (c.fetch_error?.slice(0, 30) ?? 'fail');
    lines.push(`| ${c.store} | ${c.product_count} | ${yn(c.has_jsonld_product)} | ${yn(c.has_og_price)} | ${yn(c.has_microdata_price)} | ${yn(c.is_shopify ? !!c.shopify_json_ok : false)} | \`${c.best_method}\` | ${fmt(c.method_price)} | ${fmt(c.gg_price)} | ${drift} | ${http} |`);
}
lines.push('');

// Highlight high-impact opportunities
const highImpact = capabilities
    .filter((c) => c.best_method !== 'none' && c.product_count >= 5)
    .sort((a, b) => b.product_count - a.product_count);
if (highImpact.length) {
    lines.push('## High-impact opportunities (≥5 products, free extraction works)');
    lines.push('');
    lines.push('These stores cover the most products AND have working free extraction.');
    lines.push('Implementing extractors for these stores eliminates Playwright + AI for hundreds of products.');
    lines.push('');
    let cumulative = 0;
    for (const c of highImpact) {
        cumulative += c.product_count;
        lines.push(`- **${c.store}** (${c.product_count} products) → \`${c.best_method}\` extraction — cumulative: ${cumulative} products`);
    }
    lines.push('');
}

// Stores that need fallback
const needsFallback = capabilities.filter((c) => c.best_method === 'none');
if (needsFallback.length) {
    lines.push('## Stores that need Playwright + AI fallback');
    lines.push('');
    lines.push('| Store | # Prods | HTTP | Notes |');
    lines.push('|---|---|---|---|');
    for (const c of needsFallback.sort((a, b) => b.product_count - a.product_count)) {
        const http = c.http_ok ? `${c.http_status}` : (c.fetch_error?.slice(0, 50) ?? 'fail');
        lines.push(`| ${c.store} | ${c.product_count} | ${http} |  |`);
    }
    lines.push('');
}

await writeFile(mdPath, lines.join('\n'));

console.log('');
console.log(`[audit] Done. Reports:`);
console.log(`  JSON: ${jsonPath}`);
console.log(`  MD:   ${mdPath}`);
console.log('');
console.log(lines.slice(0, 30).join('\n'));

process.exit(0);
