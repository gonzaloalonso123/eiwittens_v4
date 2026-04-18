import { getEnabledScrapableProducts, updateProduct } from '../db/products.js';
import { scrapeProduct } from '../scraper/index.js';
import { applySecurityCheck } from './security.js';
import { applyDiscounts } from './discounts.js';
import { applyCalculations } from './calculations.js';
import { applyWarnings, collectWarnings } from './warnings.js';
import { sendWarningDigest, sendErrorAlert } from '../notifications/email.js';
import { config } from '../config.js';
import type { Product } from '@eiwittens/types';

export interface PipelineResult {
    scrapedCount: number;
    warningCount: number;
    durationMs: number;
}

let isRunning = false;

export async function scrapeAndPush(): Promise<PipelineResult> {
    if (isRunning) {
        throw new Error('Pipeline already running — skipping duplicate execution');
    }

    isRunning = true;
    const start = Date.now();

    try {
        const oldProducts = await getEnabledScrapableProducts();
        console.log(`[pipeline] Starting scrape for ${oldProducts.length} products`);

        const scraped = await scrapeAll(oldProducts);
        const secured = applySecurityCheck(scraped, oldProducts);
        const warned = applyWarnings(secured);
        const discounted = applyDiscounts(warned);
        const final = applyCalculations(discounted);

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

async function scrapeAll(products: Product[]): Promise<Product[]> {
    const results: Product[] = [];
    for (const product of products) {
        console.log(`[scraper] "${product.name}"`);
        const { price, aiUsed } = await scrapeProduct(product);
        console.log(`[scraper] "${product.name}" → €${price}${aiUsed ? ' (AI fallback)' : ''}`);
        results.push({ ...product, price });
    }
    return results;
}

async function persistAll(products: Product[]): Promise<void> {
    for (const product of products) {
        await updateProduct(product.id, product);
    }
}
