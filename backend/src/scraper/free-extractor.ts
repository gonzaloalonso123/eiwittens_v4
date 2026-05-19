// Free price extractor — Layer 0 of the new scrape stack.
//
// Tries (in order of reliability):
//   1. Shopify /products/<handle>.json
//   2. Schema.org JSON-LD Product offers
//   3. OpenGraph product:price:amount meta
//   4. Microdata itemprop="price"
//
// Returns the first plausible price. No browser needed — plain HTTP.
//
// Safe parser features:
//   - Skips OutOfStock offers
//   - When multiple offers: picks cheapest in-stock
//   - Plausibility cap: rejects prices outside [€0.50, €1500] for supplements
//   - Cross-method validation: when JSON-LD and OG differ >50%, prefers OG
//     (default consumer variant in OG; JSON-LD sometimes has wholesale)

import type { Browser } from 'playwright';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
};

const FETCH_TIMEOUT_MS = 20_000;
const PLAYWRIGHT_TIMEOUT_MS = 30_000;
const PRICE_PLAUSIBILITY_MIN = 0.5;
const PRICE_PLAUSIBILITY_MAX = 1500;

export type FreeExtractionMethod = 'shopify_json' | 'jsonld' | 'og' | 'microdata';

export interface FreeExtractionResult {
    method: FreeExtractionMethod;
    price: number;
    currency: string;
    in_stock?: boolean;
    raw_value?: string;
    // Diagnostic: all candidate prices found by various methods
    all_candidates?: Record<string, { price: number; in_stock?: boolean }>;
}

export class NoFreeExtractionAvailable extends Error {
    constructor(public reasons: string[]) {
        super(`No free extraction available: ${reasons.join('; ')}`);
        this.name = 'NoFreeExtractionAvailable';
    }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface ExtractOptions {
    preferMethod?: FreeExtractionMethod;
    /** Playwright Browser to use when plain fetch fails with 403 or similar. */
    playwrightBrowser?: Browser;
    /** Skip plain fetch entirely and go straight to Playwright (slower). */
    forcePlaywright?: boolean;
    /** Product amount in grams. Used to disambiguate multi-variant products. */
    amountGrams?: number;
}

function amountToSizeStrings(grams: number | undefined): string[] {
    if (!grams || !isFinite(grams) || grams <= 0) return [];
    const out: string[] = [];
    out.push(`${grams}g`);
    out.push(`${grams} g`);
    out.push(`${grams}gr`);
    out.push(`${grams} gr`);
    if (grams >= 1000) {
        const kg = grams / 1000;
        const kgDot = kg % 1 === 0 ? String(kg) : String(parseFloat(kg.toFixed(2)));
        const kgComma = kgDot.replace('.', ',');
        for (const v of new Set([kgDot, kgComma])) {
            out.push(`${v}kg`);
            out.push(`${v} kg`);
        }
    }
    // Some products are quantity-based (caps/tabs)
    out.push(`${grams}stuks`);
    out.push(`${grams} stuks`);
    out.push(`${grams} tabs`);
    out.push(`${grams} caps`);
    out.push(`${grams} capsules`);
    return out;
}

function textMatchesAnySize(text: string, sizeStrings: string[]): boolean {
    if (sizeStrings.length === 0) return false;
    const lower = text.toLowerCase();
    return sizeStrings.some((s) => lower.includes(s.toLowerCase()));
}

export interface FetchOutcome {
    html: string;
    finalUrl: string;
    fetchMethod: 'plain' | 'playwright';
}

export async function extractFreePrice(url: string, opts: ExtractOptions = {}): Promise<FreeExtractionResult & { fetch_method: string }> {
    const fetched = await smartFetch(url, opts);
    const result = await extractFromHtml(fetched.html, fetched.finalUrl, opts);
    return { ...result, fetch_method: fetched.fetchMethod };
}

async function smartFetch(url: string, opts: ExtractOptions): Promise<FetchOutcome> {
    if (opts.forcePlaywright && opts.playwrightBrowser) {
        return playwrightFetch(url, opts.playwrightBrowser);
    }
    try {
        const { html, finalUrl } = await fetchHtml(url);
        return { html, finalUrl, fetchMethod: 'plain' };
    } catch (err) {
        const msg = (err as Error).message;
        const isAntiBot = msg.includes('HTTP 403') || msg.includes('HTTP 429') || msg.includes('HTTP 503');
        if (isAntiBot && opts.playwrightBrowser) {
            return playwrightFetch(url, opts.playwrightBrowser);
        }
        throw err;
    }
}

async function playwrightFetch(url: string, browser: Browser): Promise<FetchOutcome> {
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: HEADERS['User-Agent'],
        locale: 'nl-NL',
        timezoneId: 'Europe/Amsterdam',
    });
    try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PLAYWRIGHT_TIMEOUT_MS });
        const finalUrl = page.url();
        const html = await page.content();
        return { html, finalUrl, fetchMethod: 'playwright' };
    } finally {
        await context.close().catch(() => undefined);
    }
}

export async function extractFromHtml(html: string, url: string, opts: ExtractOptions = {}): Promise<FreeExtractionResult> {
    const candidates: FreeExtractionResult[] = [];
    const sizeStrings = amountToSizeStrings(opts.amountGrams);

    // 1. Shopify (HTTP call — out-of-band)
    if (isShopifyUrl(url)) {
        const shopify = await tryShopify(url, sizeStrings);
        if (shopify) candidates.push(shopify);
    }

    // 2. JSON-LD
    const jsonld = tryJsonLd(html, sizeStrings);
    if (jsonld) candidates.push(jsonld);

    // 3. OG
    const og = tryOpenGraph(html);
    if (og) candidates.push(og);

    // 4. Microdata
    const md = tryMicrodata(html);
    if (md) candidates.push(md);

    const all_candidates: Record<string, { price: number; in_stock?: boolean }> = {};
    for (const c of candidates) {
        all_candidates[c.method] = { price: c.price, in_stock: c.in_stock };
    }

    if (candidates.length === 0) {
        throw new NoFreeExtractionAvailable(['no method returned a price']);
    }

    // Plausibility filter
    const plausible = candidates.filter((c) => c.price >= PRICE_PLAUSIBILITY_MIN && c.price <= PRICE_PLAUSIBILITY_MAX);
    if (plausible.length === 0) {
        throw new NoFreeExtractionAvailable([
            'all prices implausible (outside €0.50–€1500)',
            ...candidates.map((c) => `${c.method}=€${c.price}`),
        ]);
    }

    // If caller specifies a preferred method, use it when present and plausible
    if (opts.preferMethod) {
        const preferred = plausible.find((c) => c.method === opts.preferMethod);
        if (preferred) {
            preferred.all_candidates = all_candidates;
            return preferred;
        }
    }

    // Pick by priority order. Shopify and JSON-LD are most reliable.
    // OG is often correct but sometimes contains weird values (price-per-unit, savings amount).
    // Microdata is least reliable (some shops mislabel it).
    const priority: FreeExtractionMethod[] = ['shopify_json', 'jsonld', 'og', 'microdata'];

    // Majority-vote consensus: if 2+ methods agree (within 5%), trust them over a disagreeing single method.
    // This protects against OG outliers like UPFRONT (og=€1.50 vs jsonld=€32) and BulkSupplements (og=€145 vs jsonld=€19).
    if (plausible.length >= 2) {
        const clusters: Array<typeof plausible> = [];
        for (const c of plausible) {
            let placed = false;
            for (const cluster of clusters) {
                const sample = cluster[0];
                const drift = Math.abs(c.price - sample.price) / Math.max(c.price, sample.price);
                if (drift < 0.05) {
                    cluster.push(c);
                    placed = true;
                    break;
                }
            }
            if (!placed) clusters.push([c]);
        }
        // Find the largest cluster (or the highest-priority within tied clusters)
        clusters.sort((a, b) => b.length - a.length);
        const winningCluster = clusters[0];
        if (winningCluster.length >= 2 || clusters.length === 1) {
            // Within winning cluster, use priority
            for (const method of priority) {
                const c = winningCluster.find((x) => x.method === method);
                if (c) {
                    c.all_candidates = all_candidates;
                    return c;
                }
            }
        }
    }

    for (const method of priority) {
        const c = plausible.find((c) => c.method === method);
        if (c) {
            c.all_candidates = all_candidates;
            return c;
        }
    }

    plausible[0].all_candidates = all_candidates;
    return plausible[0];
}

// ── HTTP fetch ──────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string; status: number }> {
    const res = await fetch(url, {
        headers: HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const html = await res.text();
    return { html, finalUrl: res.url, status: res.status };
}

// ── Shopify ─────────────────────────────────────────────────────────────────

function isShopifyUrl(url: string): boolean {
    return /\/products\/[a-z0-9-]+/i.test(url);
}

function buildShopifyJsonUrl(url: string): string | null {
    const m = url.match(/^(https?:\/\/[^/]+)\/products\/([a-z0-9-]+)/i);
    if (!m) return null;
    return `${m[1]}/products/${m[2]}.json`;
}

interface ShopifyVariant {
    price?: string;
    available?: boolean;
    title?: string;
    option1?: string;
    option2?: string;
    option3?: string;
}

async function tryShopify(url: string, sizeStrings: string[] = []): Promise<FreeExtractionResult | null> {
    const jsonUrl = buildShopifyJsonUrl(url);
    if (!jsonUrl) return null;
    try {
        const res = await fetch(jsonUrl, {
            headers: HEADERS,
            redirect: 'follow',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const data = await res.json() as { product?: { variants?: ShopifyVariant[] } };
        if (!data?.product?.variants) return null;
        const variants = data.product.variants;

        // Build a variant descriptor (title + options combined) to match against size
        const variantsWithDesc = variants.map((v) => ({
            ...v,
            _desc: [v.title, v.option1, v.option2, v.option3].filter(Boolean).join(' '),
            _price: parseFloat(v.price ?? '0'),
        })).filter((v) => v._price > 0);

        if (variantsWithDesc.length === 0) return null;

        // Try to match a variant whose descriptor contains the size
        let matched = sizeStrings.length > 0
            ? variantsWithDesc.filter((v) => textMatchesAnySize(v._desc, sizeStrings))
            : [];

        if (matched.length === 0) matched = variantsWithDesc;

        // Among matches: prefer in-stock, then cheapest
        const inStock = matched.filter((v) => v.available !== false);
        const pool = inStock.length > 0 ? inStock : matched;
        pool.sort((a, b) => a._price - b._price);
        const chosen = pool[0];

        return {
            method: 'shopify_json',
            price: chosen._price,
            currency: 'EUR',
            in_stock: chosen.available !== false,
        };
    } catch {
        return null;
    }
}

// ── JSON-LD ─────────────────────────────────────────────────────────────────

interface JsonLdOffer {
    price: number;
    currency: string;
    inStock: boolean;
    name?: string;
    sku?: string;
}

function tryJsonLd(html: string, sizeStrings: string[] = []): FreeExtractionResult | null {
    const scripts = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

    const allOffers: JsonLdOffer[] = [];

    for (const m of scripts) {
        try {
            const data = JSON.parse(m[1].trim());
            collectJsonLdOffers(data, allOffers);
        } catch {
            // ignore malformed
        }
    }

    if (allOffers.length === 0) return null;

    // Filter by size if hint provided
    let pool = allOffers;
    if (sizeStrings.length > 0) {
        const sized = allOffers.filter((o) => {
            const text = [o.name, o.sku].filter(Boolean).join(' ');
            return textMatchesAnySize(text, sizeStrings);
        });
        if (sized.length > 0) pool = sized;
    }

    // Prefer in-stock; if none in stock, use any
    const inStock = pool.filter((o) => o.inStock);
    pool = inStock.length > 0 ? inStock : pool;

    // Pick the cheapest plausible
    pool.sort((a, b) => a.price - b.price);
    const chosen = pool[0];

    return {
        method: 'jsonld',
        price: chosen.price,
        currency: chosen.currency,
        in_stock: chosen.inStock,
    };
}

function collectJsonLdOffers(node: unknown, sink: JsonLdOffer[]): void {
    if (!node) return;
    if (Array.isArray(node)) {
        for (const item of node) collectJsonLdOffers(item, sink);
        return;
    }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;

    // Recurse into @graph
    if (Array.isArray(obj['@graph'])) {
        collectJsonLdOffers(obj['@graph'], sink);
    }

    // Is this a Product? Then process its offers.
    const type = obj['@type'];
    const isProduct = type === 'Product' || (Array.isArray(type) && type.includes('Product'));
    if (isProduct) {
        const offers = obj.offers;
        if (offers) {
            const offerArr = Array.isArray(offers) ? offers : [offers];
            for (const offer of offerArr) {
                if (!offer || typeof offer !== 'object') continue;
                const o = offer as Record<string, unknown>;

                // AggregateOffer with nested offers
                if (Array.isArray(o.offers)) {
                    collectJsonLdOffers(o.offers, sink);
                    continue;
                }

                const priceRaw = o.price
                    ?? (o.priceSpecification as Record<string, unknown>)?.price
                    ?? o.lowPrice;
                const price = parsePrice(priceRaw);
                if (price === undefined) continue;

                const currency = (o.priceCurrency as string)
                    ?? ((o.priceSpecification as Record<string, unknown>)?.priceCurrency as string)
                    ?? 'EUR';

                const availability = String(o.availability ?? '').toLowerCase();
                const inStock = !availability.includes('outofstock')
                    && !availability.includes('discontinued')
                    && !availability.includes('soldout');

                const itemOffered = o.itemOffered as Record<string, unknown> | undefined;
                const name = String(o.name ?? itemOffered?.name ?? '');
                const sku = String(o.sku ?? itemOffered?.sku ?? '');

                sink.push({ price, currency, inStock, name, sku });
            }
        }
    }
}

// ── OpenGraph ──────────────────────────────────────────────────────────────

function tryOpenGraph(html: string): FreeExtractionResult | null {
    const priceMatch = html.match(/<meta[^>]+property=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([^"']+)["']/i)
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:product:price:amount|og:price:amount)["']/i);

    if (!priceMatch) return null;
    const price = parsePrice(priceMatch[1]);
    if (price === undefined) return null;

    const currencyMatch = html.match(/<meta[^>]+property=["'](?:product:price:currency|og:price:currency)["'][^>]+content=["']([^"']+)["']/i)
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:product:price:currency|og:price:currency)["']/i);

    return {
        method: 'og',
        price,
        currency: currencyMatch?.[1] ?? 'EUR',
    };
}

// ── Microdata ───────────────────────────────────────────────────────────────

function tryMicrodata(html: string): FreeExtractionResult | null {
    const metaMatch = html.match(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i)
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']price["']/i);
    if (metaMatch) {
        const price = parsePrice(metaMatch[1]);
        if (price !== undefined) return { method: 'microdata', price, currency: 'EUR' };
    }
    const spanMatch = html.match(/<[a-z]+[^>]+itemprop=["']price["'][^>]*>([^<]+)</i);
    if (spanMatch) {
        const price = parsePrice(spanMatch[1]);
        if (price !== undefined) return { method: 'microdata', price, currency: 'EUR' };
    }
    return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parsePrice(raw: unknown): number | undefined {
    if (raw === null || raw === undefined) return undefined;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
    const s = String(raw).trim();
    if (!s) return undefined;
    const cleaned = s.replace(/[€£$\s]/g, '');
    // Detect EU format (1.234,56) vs US (1,234.56) vs plain
    const isEu = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned) || /,\d{1,2}$/.test(cleaned);
    const normalized = isEu
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
    const final = normalized.replace(/[^\d.]/g, '');
    const n = parseFloat(final);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
