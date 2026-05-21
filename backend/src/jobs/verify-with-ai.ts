/**
 * Layer-1.5 AI verification job.
 *
 * For each candidate product, runs the existing XPath/Select chain AND the
 * Anthropic Haiku extractor against the same live page, compares prices,
 * and (in --apply mode) writes the outcome back to Firestore:
 *
 *   Both OK, agree (≤1%)       → stamp ai_verified_at + ai_verified_price
 *   Both OK, disagree          → AI wins (unless manual_lock=true), update scraper[],
 *                                bump ai_disagreement_count, set warning=true
 *   XPath fails, AI OK         → if scrape_enabled was off, re-enable + set scraper[] + price;
 *                                otherwise replace scraper[] with AI selector
 *   AI fails                   → no writes, log + skip
 *   Both fail                  → no writes, log + skip
 *
 * The job preserves non-Select actions (Click, ClickByText, Wait, SelectOption) when
 * replacing — matches the production fallback behaviour in `scraper/index.ts`.
 *
 * Usage:
 *   pnpm tsx src/jobs/verify-with-ai.ts                              # full dry-run on all Layer 1 + non-MyProtein hard-priced
 *   pnpm tsx src/jobs/verify-with-ai.ts --product-ids id1,id2,id3   # subset
 *   pnpm tsx src/jobs/verify-with-ai.ts --store "Basic Whey"        # one shop
 *   pnpm tsx src/jobs/verify-with-ai.ts --limit 20                  # cap
 *   pnpm tsx src/jobs/verify-with-ai.ts --include-hard-priced       # also include scrape_enabled=false products (default: ON)
 *   pnpm tsx src/jobs/verify-with-ai.ts --exclude-hard-priced       # opt out
 *   pnpm tsx src/jobs/verify-with-ai.ts --concurrency 3             # parallel browsers (default 3)
 *   pnpm tsx src/jobs/verify-with-ai.ts --stale-days 30             # consider re-verifying products verified less than N days ago (default: never re-verify)
 *   pnpm tsx src/jobs/verify-with-ai.ts -- --apply                  # write to Firestore
 */
import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import type { Browser } from 'playwright';
import { db } from '../db/firebase.js';
import { getProducts, updateProduct } from '../db/products.js';
import { createBrowser, createPage } from '../scraper/driver.js';
import { dismissCookieBanner, executeActions } from '../scraper/actions.js';
import { anthropicExtractPrice, anthropicExtractPriceFromImage } from '../scraper/extractor-anthropic.js';
import { cleanPrice } from '../lib/utils.js';
import type { Product, ProductUpdate, ScraperAction } from '@eiwittens/types';
import { ActionType } from '@eiwittens/types';

const AGREEMENT_TOLERANCE_PCT = 1.0;
// Plausibility envelope for a single supplement SKU: even bulk 15kg whey or
// premium creatine stays well under €500. Anything outside is treated as a
// parsing error / hallucination and triggers the next fallback layer.
const MIN_PLAUSIBLE_PRICE = 0.5;
const MAX_PLAUSIBLE_PRICE = 500;
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../..', 'verify-reports');

function isPlausible(price: number): boolean {
    return Number.isFinite(price) && price >= MIN_PLAUSIBLE_PRICE && price <= MAX_PLAUSIBLE_PRICE;
}

type Verdict =
    | 'agree'
    | 'disagree'
    | 'xpath_only'        // XPath ok, AI failed — keep status quo, no writes
    | 'ai_only'           // XPath failed, AI ok — re-enable / replace scraper
    | 'vision_only_ok'    // HTML AI failed but vision succeeded — switch to extraction_method='vision_only'
    | 'both_failed';

type WriteAction =
    | 'none'
    | 'stamp_verified'      // both agree → only verified_at/price
    | 'override_selector'   // disagree → AI wins, replace Select actions
    | 'flag_warning'        // disagree but manual_lock → just warn
    | 're_enable'           // was scrape_disabled, AI found price → re-enable
    | 'mark_vision_only'    // only vision can read this price; switch extraction_method
    | 'skip_no_ai';         // AI failed → nothing to do

interface VerifyResult {
    productId: string;
    name: string;
    store: string;
    url: string;
    wasScrapeEnabled: boolean;
    manualLock: boolean;
    hasXpathConfigured: boolean;
    referencePrice: number;
    xpathPrice: number | null;
    xpathError?: string;
    aiPrice: number | null;
    aiSelectorType?: string;
    aiSelectorValue?: string;
    aiError?: string;
    visionPrice: number | null;
    visionReasoning?: string;
    visionError?: string;
    divergencePct?: number;
    verdict: Verdict;
    writeAction: WriteAction;
    applied: boolean;
    appliedError?: string;
}

interface CliOptions {
    apply: boolean;
    productIds?: string[];
    storeFilter?: string;
    limit?: number;
    concurrency: number;
    includeHardPriced: boolean;
    excludeMyProtein: boolean;
    skipVision: boolean;
    staleDays?: number;
    help: boolean;
}

function parseArgs(args: string[]): CliOptions {
    const opts: CliOptions = {
        apply: false,
        concurrency: 2,
        includeHardPriced: true,
        excludeMyProtein: true,
        skipVision: false,
        help: false,
    };
    for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (a === '--' || a === '') continue;
        else if (a === '--help' || a === '-h') opts.help = true;
        else if (a === '--apply') opts.apply = true;
        else if (a === '--product-ids' || a === '--ids') opts.productIds = (args[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        else if (a.startsWith('--product-ids=')) opts.productIds = a.slice('--product-ids='.length).split(',').map((s) => s.trim()).filter(Boolean);
        else if (a === '--store') opts.storeFilter = args[++i];
        else if (a.startsWith('--store=')) opts.storeFilter = a.slice('--store='.length);
        else if (a === '--limit') opts.limit = Number.parseInt(args[++i] ?? '', 10);
        else if (a.startsWith('--limit=')) opts.limit = Number.parseInt(a.slice('--limit='.length), 10);
        else if (a === '--concurrency') opts.concurrency = Number.parseInt(args[++i] ?? '', 10);
        else if (a.startsWith('--concurrency=')) opts.concurrency = Number.parseInt(a.slice('--concurrency='.length), 10);
        else if (a === '--include-hard-priced') opts.includeHardPriced = true;
        else if (a === '--exclude-hard-priced') opts.includeHardPriced = false;
        else if (a === '--include-myprotein') opts.excludeMyProtein = false;
        else if (a === '--exclude-myprotein') opts.excludeMyProtein = true;
        else if (a === '--stale-days') opts.staleDays = Number.parseInt(args[++i] ?? '', 10);
        else if (a.startsWith('--stale-days=')) opts.staleDays = Number.parseInt(a.slice('--stale-days='.length), 10);
        else if (a === '--skip-vision') opts.skipVision = true;
        else throw new Error(`Unknown argument: ${a}`);
    }
    return opts;
}

function printUsage(): void {
    console.log(`Verify products' prices using parallel XPath + AI extraction.

Default scope: enabled products that are either
  (a) in the daily scrape (scrape_enabled=true, extraction_method != free_* and != feed_awin), OR
  (b) hard-priced workarounds (scrape_enabled=false) excluding MyProtein (use Awin feed instead).

Options:
  --product-ids id1,id2,id3   Verify only these specific product IDs
  --store "Basic Whey"        Filter to one store
  --limit N                   Cap total candidates
  --concurrency N             Parallel browsers (default 3)
  --include-hard-priced       Include scrape_enabled=false products (default ON)
  --exclude-hard-priced       Skip scrape_enabled=false products
  --include-myprotein         Include MyProtein products (default OFF — they go via Awin feed)
  --stale-days N              Skip products verified within the last N days
  --apply                     Write updates to Firestore (default: dry-run, no writes)
  --help                      Show this help
`);
}

function ageInDays(value: Product['ai_verified_at']): number | null {
    if (!value) return null;
    let ms: number;
    if (value instanceof Date) ms = value.getTime();
    else if (typeof value === 'object' && 'seconds' in value) ms = (value as { seconds: number }).seconds * 1000;
    else return null;
    return (Date.now() - ms) / (1000 * 60 * 60 * 24);
}

function selectCandidates(all: Product[], opts: CliOptions): Product[] {
    let candidates = all.filter((p) => p.enabled);

    // Layer 0 (free_*) and feed_awin: skip — they don't need verification
    candidates = candidates.filter((p) => {
        const m = p.extraction_method ?? '';
        if (m.startsWith('free_')) return false;
        if (m === 'feed_awin') return false;
        return true;
    });

    // Hard-priced toggle
    if (!opts.includeHardPriced) {
        candidates = candidates.filter((p) => p.scrape_enabled);
    }

    // MyProtein toggle (default exclude — they go via Awin)
    if (opts.excludeMyProtein) {
        candidates = candidates.filter((p) => p.store !== 'MyProtein');
    }

    // Store filter
    if (opts.storeFilter) {
        candidates = candidates.filter((p) => p.store === opts.storeFilter);
    }

    // Stale-days filter — skip recently verified products
    if (opts.staleDays !== undefined && Number.isFinite(opts.staleDays)) {
        const cutoff = opts.staleDays;
        candidates = candidates.filter((p) => {
            const age = ageInDays(p.ai_verified_at);
            return age === null || age >= cutoff;
        });
    }

    // Product-IDs filter — takes precedence over other filters once provided
    if (opts.productIds && opts.productIds.length > 0) {
        const ids = new Set(opts.productIds);
        // Re-fetch from `all` to ensure we still include products even if filtered out above
        candidates = all.filter((p) => ids.has(p.id));
    }

    if (opts.limit !== undefined && Number.isFinite(opts.limit)) {
        candidates = candidates.slice(0, opts.limit);
    }

    return candidates;
}

function computeVerdict(
    xpath: number | null,
    ai: number | null,
    vision: number | null,
): { verdict: Verdict; divergencePct?: number } {
    if (xpath !== null && ai !== null) {
        const diff = Math.abs(xpath - ai);
        const max = Math.max(xpath, ai);
        const pct = max > 0 ? (diff / max) * 100 : 0;
        if (pct <= AGREEMENT_TOLERANCE_PCT) return { verdict: 'agree', divergencePct: pct };
        return { verdict: 'disagree', divergencePct: pct };
    }
    if (xpath !== null && ai === null) return { verdict: 'xpath_only' };
    if (xpath === null && ai !== null) return { verdict: 'ai_only' };
    if (xpath === null && ai === null && vision !== null) return { verdict: 'vision_only_ok' };
    return { verdict: 'both_failed' };
}

function planWrite(verdict: Verdict, product: Product): WriteAction {
    // manual_lock=true means: the user has taken explicit ownership of this
    // product's configuration. verify-with-ai may stamp verification metadata
    // and surface warnings, but it MUST NOT modify scraper[], scrape_enabled,
    // extraction_method, or price.
    if (product.manual_lock) {
        switch (verdict) {
            case 'agree': return 'stamp_verified';      // both agree → safe metadata-only stamp
            case 'disagree':
            case 'ai_only':
            case 'vision_only_ok':
                // AI saw a different price but user has locked this product.
                // Warn so the dashboard surfaces it, but do not touch config.
                return 'flag_warning';
            case 'xpath_only': return 'none';
            case 'both_failed': return 'skip_no_ai';
        }
    }
    switch (verdict) {
        case 'agree': return 'stamp_verified';
        case 'disagree': return 'override_selector';
        case 'ai_only': return product.scrape_enabled ? 'override_selector' : 're_enable';
        case 'vision_only_ok': return 'mark_vision_only';
        case 'xpath_only': return 'none';
        case 'both_failed': return 'skip_no_ai';
    }
}

function buildScraperWithAiSelector(existing: ScraperAction[], aiFix: ScraperAction[]): ScraperAction[] {
    const nonSelect = existing.filter((a) => a.type !== ActionType.Select);
    return [...nonSelect, ...aiFix];
}

async function applyUpdate(
    product: Product,
    verdict: Verdict,
    action: WriteAction,
    aiPrice: number,
    aiFix: ScraperAction[],
    visionPrice: number,
): Promise<void> {
    const now = new Date();
    const update: ProductUpdate = {};

    switch (action) {
        case 'none':
        case 'skip_no_ai':
            return;
        case 'stamp_verified':
            update.ai_verified_at = now;
            update.ai_verified_price = aiPrice;
            // Daily scrape may be down or stale — keep the live price field in sync
            // with what AI just observed, since XPath agrees with AI here.
            update.price = aiPrice;
            break;
        case 'flag_warning':
            // Triggered when manual_lock=true AND AI disagrees with the locked
            // config. Stamp verification metadata + warn — but DO NOT touch
            // price, scraper, scrape_enabled, or extraction_method. The user
            // owns this product's config.
            update.ai_verified_at = now;
            update.ai_verified_price = aiPrice;
            update.ai_disagreement_count = (product.ai_disagreement_count ?? 0) + 1;
            update.warning = true;
            break;
        case 'override_selector':
            if (aiFix.length === 0) return; // nothing to override with
            update.scraper = buildScraperWithAiSelector(product.scraper ?? [], aiFix);
            update.ai_verified_at = now;
            update.ai_verified_price = aiPrice;
            update.ai_disagreement_count = (product.ai_disagreement_count ?? 0) + (verdict === 'disagree' ? 1 : 0);
            if (verdict === 'disagree') update.warning = true;
            // AI is the source of truth for any disagree/ai_only outcome — write its
            // price so the catalogue reflects what users will pay today.
            update.price = aiPrice;
            break;
        case 're_enable':
            if (aiFix.length === 0) return;
            update.scraper = buildScraperWithAiSelector(product.scraper ?? [], aiFix);
            update.scrape_enabled = true;
            update.price = aiPrice;
            update.ai_verified_at = now;
            update.ai_verified_price = aiPrice;
            break;
        case 'mark_vision_only':
            // Vision could read the price but HTML couldn't. Daily scrape skips
            // these; monthly verify is the only refresher. We also clear the
            // Select actions (their selectors are useless here) but keep any
            // Click/cookie actions.
            update.extraction_method = 'vision_only';
            update.scraper = (product.scraper ?? []).filter((a) => a.type !== ActionType.Select);
            update.scrape_enabled = true;  // re-enable if it was off
            update.price = visionPrice;
            update.ai_verified_at = now;
            update.ai_verified_price = visionPrice;
            break;
    }

    if (Object.keys(update).length === 0) return;
    await updateProduct(product.id, update);
}

async function verifyOne(product: Product, browser: Browser, skipVision: boolean): Promise<VerifyResult> {
    const result: VerifyResult = {
        productId: product.id,
        name: product.name,
        store: product.store,
        url: product.url,
        wasScrapeEnabled: !!product.scrape_enabled,
        manualLock: !!product.manual_lock,
        hasXpathConfigured: Array.isArray(product.scraper) && product.scraper.some((a) => a.type === ActionType.Select),
        referencePrice: product.price ?? 0,
        xpathPrice: null,
        aiPrice: null,
        visionPrice: null,
        verdict: 'both_failed',
        writeAction: 'none',
        applied: false,
    };

    const { page, cleanup } = await createPage(browser);
    try {
        // ── XPath path ───────────────────────────────────────────────────
        if (result.hasXpathConfigured && product.scrape_enabled) {
            try {
                await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                await dismissCookieBanner(page, product.cookieBannerXPaths ?? []);
                const raw = await executeActions(page, product.scraper);
                const parsed = cleanPrice(raw);
                if (isPlausible(parsed)) {
                    result.xpathPrice = parsed;
                } else {
                    result.xpathError = `Implausible price: "${raw}" → ${parsed}`;
                }
            } catch (err) {
                result.xpathError = (err as Error).message.slice(0, 200);
            }
        }

        // ── HTML AI path (always fresh page) ─────────────────────────────
        try {
            await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await dismissCookieBanner(page, product.cookieBannerXPaths ?? []);
            const aiResult = await anthropicExtractPrice(page, product.url);
            if (isPlausible(aiResult.price)) {
                result.aiPrice = aiResult.price;
                if (aiResult.fixedScraper[0]?.type === ActionType.Select) {
                    const sel = aiResult.fixedScraper[0];
                    result.aiSelectorType = sel.selectorType;
                    result.aiSelectorValue = sel.selectorValue;
                }
                (result as VerifyResult & { _aiFix?: ScraperAction[] })._aiFix = aiResult.fixedScraper;
            } else {
                result.aiError = `Implausible AI price: ${aiResult.price} (rawAi="${aiResult.rawAiPrice}")`;
            }
        } catch (err) {
            const msg = (err as Error).message;
            result.aiError = msg.slice(0, 200);
            console.warn(`  [html-ai] ${result.productId} ${result.store} — ${msg.slice(0, 200)}`);
        }

        // ── Vision fallback (Layer 3) ─────────────────────────────────────
        // Only if HTML AI failed or returned implausible, AND we haven't
        // disabled vision via --skip-vision. Reuses the already-navigated page.
        if (!skipVision && result.aiPrice === null) {
            try {
                const visionResult = await anthropicExtractPriceFromImage(page, product.url);
                if (isPlausible(visionResult.price)) {
                    result.visionPrice = visionResult.price;
                    result.visionReasoning = visionResult.reasoning;
                } else {
                    result.visionError = `Implausible vision price: ${visionResult.price}`;
                }
            } catch (err) {
                const msg = (err as Error).message;
                result.visionError = msg.slice(0, 200);
                console.warn(`  [vision-ai] ${result.productId} ${result.store} — ${msg.slice(0, 200)}`);
            }
        }
    } finally {
        await cleanup();
    }

    const { verdict, divergencePct } = computeVerdict(result.xpathPrice, result.aiPrice, result.visionPrice);
    result.verdict = verdict;
    if (divergencePct !== undefined) result.divergencePct = divergencePct;
    result.writeAction = planWrite(verdict, product);

    return result;
}

async function runWithConcurrency(
    products: Product[],
    concurrency: number,
    apply: boolean,
    skipVision: boolean,
    productsMap: Map<string, Product>,
): Promise<VerifyResult[]> {
    const browsers: Browser[] = await Promise.all(Array.from({ length: concurrency }, () => createBrowser()));
    const results: VerifyResult[] = [];
    let nextIndex = 0;
    const total = products.length;

    try {
        await Promise.all(browsers.map(async (browser) => {
            while (nextIndex < total) {
                const idx = nextIndex++;
                const product = products[idx];
                console.log(`[${idx + 1}/${total}] ${product.store} — ${product.name.slice(0, 60)}`);
                try {
                    const result = await verifyOne(product, browser, skipVision);
                    results.push(result);
                    const x = result.xpathPrice === null ? 'NULL' : `€${result.xpathPrice.toFixed(2)}`;
                    const a = result.aiPrice === null ? 'NULL' : `€${result.aiPrice.toFixed(2)}`;
                    const v = result.visionPrice === null ? '' : ` vision=€${result.visionPrice.toFixed(2)}`;
                    const div = result.divergencePct !== undefined ? ` Δ${result.divergencePct.toFixed(1)}%` : '';
                    console.log(`  → xpath=${x} ai=${a}${v}${div} verdict=${result.verdict} write=${result.writeAction}`);

                    if (apply) {
                        try {
                            const aiFix = (result as VerifyResult & { _aiFix?: ScraperAction[] })._aiFix ?? [];
                            const reloaded = productsMap.get(product.id) ?? product;
                            await applyUpdate(
                                reloaded,
                                result.verdict,
                                result.writeAction,
                                result.aiPrice ?? 0,
                                aiFix,
                                result.visionPrice ?? 0,
                            );
                            result.applied = true;
                            console.log(`  ✓ applied: ${result.writeAction}`);
                        } catch (err) {
                            result.appliedError = (err as Error).message.slice(0, 200);
                            console.log(`  ✗ apply failed: ${result.appliedError}`);
                        }
                    }
                } catch (err) {
                    console.error(`  ✗ FAILED: ${(err as Error).message}`);
                    results.push({
                        productId: product.id,
                        name: product.name,
                        store: product.store,
                        url: product.url,
                        wasScrapeEnabled: !!product.scrape_enabled,
                        manualLock: !!product.manual_lock,
                        hasXpathConfigured: false,
                        referencePrice: product.price ?? 0,
                        xpathPrice: null,
                        aiPrice: null,
                        visionPrice: null,
                        verdict: 'both_failed',
                        writeAction: 'none',
                        applied: false,
                        appliedError: `Unexpected: ${(err as Error).message.slice(0, 200)}`,
                    });
                }
            }
        }));
    } finally {
        await Promise.all(browsers.map((b) => b.close().catch(() => undefined)));
    }

    return results;
}

function summarize(results: VerifyResult[], apply: boolean): string {
    const verdictCounts: Record<string, number> = {};
    const writeCounts: Record<string, number> = {};
    let applied = 0;
    let appliedErrors = 0;
    for (const r of results) {
        verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;
        writeCounts[r.writeAction] = (writeCounts[r.writeAction] ?? 0) + 1;
        if (r.applied) applied++;
        if (r.appliedError) appliedErrors++;
    }

    const lines: string[] = [];
    lines.push('# Verify-with-AI Report');
    lines.push('');
    lines.push(`*Generated: ${new Date().toISOString()}*`);
    lines.push(`*Sample size: ${results.length} products*`);
    lines.push(`*Mode: ${apply ? '**APPLY** (Firestore writes happened)' : 'dry-run (no writes)'}*`);
    lines.push('');
    lines.push('## Verdicts');
    lines.push('| Verdict | Count |');
    lines.push('|---|---|');
    for (const [v, c] of Object.entries(verdictCounts).sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${v} | ${c} |`);
    }
    lines.push('');
    lines.push('## Planned writes');
    lines.push('| Write action | Count |');
    lines.push('|---|---|');
    for (const [w, c] of Object.entries(writeCounts).sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${w} | ${c} |`);
    }
    if (apply) {
        lines.push('');
        lines.push(`## Apply results`);
        lines.push(`- writes succeeded: ${applied}`);
        lines.push(`- writes failed: ${appliedErrors}`);
    }
    lines.push('');
    lines.push('## Per-product detail');
    lines.push('| Store | Name | XPath € | AI € | Vision € | Δ% | Verdict | Write action | Applied |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of results) {
        const x = r.xpathPrice === null ? (r.xpathError ? `(err: ${r.xpathError.slice(0, 30)})` : 'NULL') : `€${r.xpathPrice.toFixed(2)}`;
        const a = r.aiPrice === null ? (r.aiError ? `(err: ${r.aiError.slice(0, 30)})` : 'NULL') : `€${r.aiPrice.toFixed(2)}`;
        const v = r.visionPrice === null ? (r.visionError ? `(err: ${r.visionError.slice(0, 30)})` : '—') : `€${r.visionPrice.toFixed(2)}`;
        const d = r.divergencePct !== undefined ? `${r.divergencePct.toFixed(1)}%` : '—';
        lines.push(`| ${r.store} | ${r.name.slice(0, 60)} | ${x} | ${a} | ${v} | ${d} | ${r.verdict} | ${r.writeAction} | ${r.applied ? '✓' : (r.appliedError ? '✗' : '—')} |`);
    }
    lines.push('');
    return lines.join('\n');
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        printUsage();
        return;
    }

    console.log(`[verify-with-ai] Mode: ${opts.apply ? 'APPLY (writes to Firestore)' : 'DRY RUN'}`);
    console.log(`[verify-with-ai] Loading products...`);
    const all = await getProducts();
    const productsMap = new Map(all.map((p) => [p.id, p] as const));
    console.log(`[verify-with-ai] Loaded ${all.length} products from Firestore`);

    const candidates = selectCandidates(all, opts);
    console.log(`[verify-with-ai] ${candidates.length} candidates selected`);
    if (candidates.length === 0) {
        console.log('[verify-with-ai] Nothing to do. Exit.');
        return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is not set in backend/.env');
    }

    const results = await runWithConcurrency(candidates, opts.concurrency, opts.apply, opts.skipVision, productsMap);

    // Write report
    await mkdir(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = resolve(REPORT_DIR, `verify-${stamp}${opts.apply ? '-applied' : '-dryrun'}.md`);
    await writeFile(reportPath, summarize(results, opts.apply), 'utf-8');
    console.log(`\n[verify-with-ai] Report saved: ${reportPath}`);

    // Console summary
    console.log('\n=== Summary ===');
    const verdictCounts: Record<string, number> = {};
    const writeCounts: Record<string, number> = {};
    for (const r of results) {
        verdictCounts[r.verdict] = (verdictCounts[r.verdict] ?? 0) + 1;
        writeCounts[r.writeAction] = (writeCounts[r.writeAction] ?? 0) + 1;
    }
    console.log('Verdicts:');
    for (const [k, v] of Object.entries(verdictCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(15)} ${v}`);
    console.log('Write actions:');
    for (const [k, v] of Object.entries(writeCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`);
    if (opts.apply) {
        const applied = results.filter((r) => r.applied).length;
        const failed = results.filter((r) => r.appliedError).length;
        console.log(`Applied: ${applied} succeeded, ${failed} failed`);
    }
    // Silence unused var lint
    void crypto;
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('verify-with-ai failed:', err);
    process.exit(1);
});
