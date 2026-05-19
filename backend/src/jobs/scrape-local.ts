import { getEnabledScrapableProducts, getProductById } from '../db/products.js';
import { scrapeAndPushResumable } from '../pipeline/index.js';
import { createBrowser } from '../scraper/driver.js';
import { scrapeProductWithBrowser } from '../scraper/index.js';
import type { Product } from '@eiwittens/types';

interface LocalScrapeOptions {
    productId?: string;
    limit?: number;
    persist: boolean;
    help: boolean;
}

interface LocalScrapeResult {
    product: Product;
    price: number;
    aiUsed: boolean;
    error?: string;
}

try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        printUsage();
        process.exit(0);
    }

    if (options.persist) {
        console.warn('[local-scrape] Running the full pipeline locally. This writes to Firestore and sends alerts.');
        const result = await scrapeAndPushResumable();
        console.log('[local-scrape] Completed persisted scrape', result);
        process.exit(0);
    }

    const products = await getProductsToScrape(options);
    if (products.length === 0) {
        throw new Error('No products matched the local scrape options');
    }

    console.log(
        `[local-scrape] Dry run for ${products.length} product${products.length === 1 ? '' : 's'}. ` +
        'Prices, scrape runs, alerts, and AI selector fixes will not be persisted.',
    );

    const results = await scrapeProductsLocally(products);
    const failed = results.filter((result) => result.error);

    console.log('[local-scrape] Summary');
    for (const result of results) {
        if (result.error) {
            console.log(`  FAIL ${result.product.name}: ${result.error}`);
        } else {
            console.log(`  OK ${result.product.name}: EUR ${result.price}${result.aiUsed ? ' (AI fallback)' : ''}`);
        }
    }

    console.log(
        `[local-scrape] Done - ${results.length - failed.length} succeeded, ${failed.length} failed`,
    );
    process.exit(failed.length > 0 ? 1 : 0);
} catch (err) {
    console.error('[local-scrape] Failed', err);
    process.exit(1);
}

async function getProductsToScrape(options: LocalScrapeOptions): Promise<Product[]> {
    if (options.productId) {
        const product = await getProductById(options.productId);
        if (!product) {
            throw new Error(`Product not found: ${options.productId}`);
        }
        return [product];
    }

    const products = await getEnabledScrapableProducts();
    return typeof options.limit === 'number' ? products.slice(0, options.limit) : products;
}

async function scrapeProductsLocally(products: Product[]): Promise<LocalScrapeResult[]> {
    const browser = await createBrowser();
    const results: LocalScrapeResult[] = [];

    try {
        for (const product of products) {
            console.log(`[local-scrape] Scraping "${product.name}"`);
            try {
                const result = await scrapeProductWithBrowser(product, browser, { persistFixedScraper: false });
                results.push({ product, ...result });
            } catch (err) {
                results.push({ product, price: 0, aiUsed: false, error: (err as Error).message });
            }
        }
    } finally {
        console.log('[driver] Cleaning up local scrape browser');
        try { await browser.close(); } catch { /* ignore */ }
    }

    return results;
}

function parseArgs(args: string[]): LocalScrapeOptions {
    const options: LocalScrapeOptions = { persist: false, help: false };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        if (arg === '--') {
            continue;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--persist') {
            options.persist = true;
        } else if (arg === '--product-id' || arg === '--id') {
            options.productId = readValue(args, index, arg);
            index += 1;
        } else if (arg.startsWith('--product-id=')) {
            options.productId = arg.slice('--product-id='.length);
        } else if (arg.startsWith('--id=')) {
            options.productId = arg.slice('--id='.length);
        } else if (arg === '--limit') {
            options.limit = parsePositiveInteger(readValue(args, index, arg), arg);
            index += 1;
        } else if (arg.startsWith('--limit=')) {
            options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

function readValue(args: string[], index: number, name: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${name} requires a value`);
    }
    return value;
}

function parsePositiveInteger(value: string, name: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
}

function printUsage(): void {
    console.log(`Run a scrape locally for testing.

Usage:
  pnpm scrape:local
  pnpm scrape:local -- --limit 5
  pnpm scrape:local -- --product-id PRODUCT_ID
  pnpm scrape:local -- --persist

Default mode is a dry run: it scrapes and prints prices without updating product prices,
creating scrape-run records, sending alert emails, or persisting AI selector fixes.

Options:
  --product-id, --id <id>  Scrape one product by Firestore document ID
  --limit <count>         Scrape only the first enabled scrapable products
  --persist               Run the full production pipeline locally
  --help, -h              Show this help text`);
}