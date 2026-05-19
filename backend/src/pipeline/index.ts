import { getEnabledScrapableProducts, getProductById, updateProduct } from '../db/products.js';
import {
    finishScrapeRun,
    getRetryableRunItems,
    getScrapeRunId,
    initializeScrapeRun,
    markRunItemCompleted,
    markRunItemFailed,
    markRunItemRunning,
    summarizeScrapeRun,
    type CompletedScrapeRunItem,
    type ScrapeRunItem,
} from '../db/scrape-runs.js';
import { createBrowser } from '../scraper/driver.js';
import { scrapeProduct, scrapeProductWithBrowser } from '../scraper/index.js';
import { applySecurityCheck } from './security.js';
import { applyDiscounts } from './discounts.js';
import { applyCalculations } from './calculations.js';
import { applyWarnings, collectWarnings } from './warnings.js';
import { sendWarningDigest, sendErrorAlert } from '../notifications/email.js';
import { config } from '../config.js';
import type { Product, ProductUpdate } from '@eiwittens/types';
import type { Browser } from 'playwright';
import { FieldValue } from 'firebase-admin/firestore';

export interface PipelineResult {
    scrapedCount: number;
    failedCount: number;
    warningCount: number;
    durationMs: number;
    runId?: string;
}

let isRunning = false;

export async function scrapeAndPush(): Promise<PipelineResult> {
    if (isRunning) {
        throw new Error('Pipeline already running — skipping duplicate execution');
    }

    isRunning = true;
    const start = Date.now();

    try {
        const oldProducts = selectProductsForScrape(await getEnabledScrapableProducts());
        console.log(`[pipeline] Starting scrape for ${oldProducts.length} products`);

        const scraped = await scrapeAll(oldProducts);
        const secured = applySecurityCheck(scraped, oldProducts);
        const discounted = applyDiscounts(secured);
        const calculated = applyCalculations(discounted);
        const final = applyWarnings(calculated);

        await persistAll(final);

        const warnings = collectWarnings(final);
        if (warnings.length > 0) {
            await sendWarningDigest(warnings, final);
        }
        if (warnings.length > config.ALLOWED_WARNINGS) {
            await sendErrorAlert(
                `Too many warnings after scrape run: ${warnings.length} products flagged. ` +
                `Threshold is ${config.ALLOWED_WARNINGS}.`,
            );
        }

        const result: PipelineResult = {
            scrapedCount: final.length,
            failedCount: 0,
            warningCount: warnings.length,
            durationMs: Date.now() - start,
        };
        console.log(
            `[pipeline] Done — ${result.scrapedCount} products, ` +
            `${result.warningCount} warnings, ${result.durationMs}ms`,
        );
        return result;
    } catch (err) {
        await sendErrorAlert(`Pipeline failed: ${(err as Error).message}`);
        throw err;
    } finally {
        isRunning = false;
    }
}

export async function scrapeAndPushResumable(): Promise<PipelineResult> {
    if (isRunning) {
        throw new Error('Pipeline already running — skipping duplicate execution');
    }

    isRunning = true;
    const start = Date.now();
    const runId = getScrapeRunId();

    try {
        const oldProducts = selectProductsForScrape(await getEnabledScrapableProducts());
        await initializeScrapeRun(runId, oldProducts);
        console.log(`[pipeline] Starting resumable scrape ${runId} for ${oldProducts.length} products`);

        const retryableItems = await getRetryableRunItems(runId, config.SCRAPE_STALE_AFTER_MS);
        await runWithBrowserConcurrency(retryableItems, config.SCRAPE_CONCURRENCY, async (item, browser) => {
            await scrapeRunItem(runId, item, browser);
        });

        const summary = await summarizeScrapeRun(runId);
        const final = await finalizeRun(summary.completedItems);

        const warnings = collectWarnings(final);
        if (warnings.length > 0) {
            await sendWarningDigest(warnings, final);
        }
        if (warnings.length > config.ALLOWED_WARNINGS) {
            await sendErrorAlert(
                `Too many warnings after scrape run ${runId}: ${warnings.length} products flagged. ` +
                `Threshold is ${config.ALLOWED_WARNINGS}.`,
            );
        }
        if (summary.failedItems.length > 0) {
            await sendErrorAlert(buildFailedProductsAlert(runId, summary.failedItems));
        }

        const durationMs = Date.now() - start;
        await finishScrapeRun(
            runId,
            summary.failedItems.length > 0 ? 'completed_with_failures' : 'succeeded',
            warnings.length,
            durationMs,
        );

        const result: PipelineResult = {
            scrapedCount: summary.completedItems.length,
            failedCount: summary.failedItems.length,
            warningCount: warnings.length,
            durationMs,
            runId,
        };
        console.log(
            `[pipeline] Resumable run ${runId} done — ${result.scrapedCount} scraped, ` +
            `${result.failedCount} failed, ${result.warningCount} warnings, ${result.durationMs}ms`,
        );
        return result;
    } catch (err) {
        const durationMs = Date.now() - start;
        await finishScrapeRun(runId, 'failed', 0, durationMs).catch(() => undefined);
        await sendErrorAlert(`Pipeline run ${runId} failed: ${(err as Error).message}`);
        throw err;
    } finally {
        isRunning = false;
    }
}

async function scrapeAll(products: Product[]): Promise<Product[]> {
    const results: Product[] = [];
    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        console.log(`[scraper] "${product.name}" (${i + 1}/${products.length})`);
        const { price, aiUsed } = await scrapeProduct(product);
        console.log(`[scraper] "${product.name}" → €${price}${aiUsed ? ' (AI fallback)' : ''}`);
        results.push({ ...product, price });
    }
    return results;
}

async function persistAll(products: Product[]): Promise<void> {
    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        console.log(`[persist] "${product.name}" (${i + 1}/${products.length})`);
        await updateProduct(product.id, product);
    }
}

async function scrapeRunItem(runId: string, item: ScrapeRunItem, browser?: Browser): Promise<void> {
    const currentProduct = await getProductById(item.productId);
    const product = currentProduct ?? item.baselineProduct;

    try {
        await markRunItemRunning(runId, item.productId);
        console.log(`[scraper] "${product.name}"`);
        const { price, aiUsed, validation } = browser
            ? await scrapeProductWithBrowser(product, browser)
            : await scrapeProduct(product);
        if (!isValidPrice(price)) {
            throw new Error(`Invalid scraped price: ${price}`);
        }
        console.log(`[scraper] "${product.name}" → €${price}${aiUsed ? ' (AI fallback)' : ''}`);
        await markRunItemCompleted(runId, item.productId, price, aiUsed, validation);
    } catch (err) {
        const message = (err as Error).message;
        console.error(`[scraper] "${product.name}" failed: ${message}`);
        await markRunItemFailed(runId, item.productId, message);
    }
}

async function finalizeRun(completedItems: CompletedScrapeRunItem[]): Promise<Product[]> {
    const validCompletedItems = completedItems.filter((item) => isValidPrice(item.scrapedPrice));
    const skippedCount = completedItems.length - validCompletedItems.length;

    if (skippedCount > 0) {
        console.warn(`[pipeline] Skipping ${skippedCount} completed items with invalid scraped prices`);
    }

    const oldProducts = validCompletedItems.map((item) => item.baselineProduct);
    const newProducts = await Promise.all(validCompletedItems.map(async (item) => {
        const current = await getProductById(item.productId);
        const product = current ?? item.baselineProduct;
        return { ...product, price: item.scrapedPrice };
    }));

    const secured = applySecurityCheck(newProducts, oldProducts);
    const discounted = applyDiscounts(secured);
    const calculated = applyCalculations(discounted);
    const final = applyWarnings(calculated);

    await persistFinalProducts(final);
    return final;
}

async function persistFinalProducts(products: Product[]): Promise<void> {
    for (const product of products) {
        const {
            price,
            provisional_price,
            warning,
            price_for_element_gram,
            price_per_dose,
            price_per_100_calories,
            price_per_1000_calories,
        } = product;

        await updateProduct(product.id, {
            price,
            provisional_price: provisional_price ?? null,
            warning,
            price_for_element_gram: price_for_element_gram ?? FieldValue.delete(),
            price_per_dose: price_per_dose ?? FieldValue.delete(),
            price_per_100_calories: price_per_100_calories ?? FieldValue.delete(),
            price_per_1000_calories: price_per_1000_calories ?? FieldValue.delete(),
        } as ProductUpdate);
    }
}

function isValidPrice(price: number): boolean {
    return Number.isFinite(price) && price > 0;
}

function selectProductsForScrape(products: Product[]): Product[] {
    let selected = products;

    if (config.SCRAPE_PRODUCT_ID) {
        selected = selected.filter((product) => product.id === config.SCRAPE_PRODUCT_ID);
        console.log(`[pipeline] SCRAPE_PRODUCT_ID=${config.SCRAPE_PRODUCT_ID} selected ${selected.length} products`);
    }

    if (config.SCRAPE_LIMIT) {
        selected = selected.slice(0, config.SCRAPE_LIMIT);
        console.log(`[pipeline] SCRAPE_LIMIT=${config.SCRAPE_LIMIT} selected ${selected.length} products`);
    }

    return selected;
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const item = items[nextIndex++];
            await worker(item);
        }
    }));
}

async function runWithBrowserConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, browser: Browser) => Promise<void>,
): Promise<void> {
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
        const browser = await createBrowser();
        try {
            while (nextIndex < items.length) {
                const item = items[nextIndex++];
                await worker(item, browser);
            }
        } finally {
            console.log(`[driver] Cleaning up worker browser`);
            try { await browser.close(); } catch { /* ignore */ }
        }
    }));
}

function buildFailedProductsAlert(
    runId: string,
    failedItems: Array<{ productId: string; baselineProduct: Product; error: string }>,
): string {
    const rows = failedItems
        .map((item) => `<li>${item.baselineProduct.name} (${item.productId}): ${item.error}</li>`)
        .join('');
    return `<p>Scrape run ${runId} completed with ${failedItems.length} failed products.</p><ul>${rows}</ul>`;
}
