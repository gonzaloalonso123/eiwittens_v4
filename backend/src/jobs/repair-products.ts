import { FieldValue } from 'firebase-admin/firestore';
import { getProducts } from '../db/products.js';
import { db } from '../db/firebase.js';
import { applyCalculations } from '../pipeline/calculations.js';
import { applyWarnings } from '../pipeline/warnings.js';
import type { Product } from '@eiwittens/types';
import type { ScrapeRunItem } from '../db/scrape-runs.js';

interface RepairOptions {
    write: boolean;
    all: boolean;
    runLimit: number;
    help: boolean;
}

interface RepairCandidate {
    product: Product;
    repairedProduct: Product;
    source: 'current' | 'scrape-run-baseline' | 'scrape-run-result';
}

try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        printUsage();
        process.exit(0);
    }

    const products = await getProducts();
    const previousPrices = await loadPreviousValidPrices(options.runLimit);
    const candidates = buildRepairCandidates(products, previousPrices, options);

    console.log(
        `[repair-products] ${options.write ? 'Writing' : 'Dry run for'} ${candidates.length} ` +
        `product${candidates.length === 1 ? '' : 's'}`,
    );

    for (const candidate of candidates) {
        const before = candidate.product;
        const after = candidate.repairedProduct;
        console.log(
            `[repair-products] ${before.name}: price ${before.price} -> ${after.price}, ` +
            `warning ${String(before.warning)} -> ${String(after.warning)} (${candidate.source})`,
        );

        if (options.write) {
            await db.collection('products').doc(before.id).update(buildRepairUpdate(after));
        }
    }

    const invalidWithoutBackup = products.filter((product) => (
        !isValidPrice(product.price) && !previousPrices.has(product.id)
    ));

    if (invalidWithoutBackup.length > 0) {
        console.warn(
            `[repair-products] ${invalidWithoutBackup.length} product${invalidWithoutBackup.length === 1 ? '' : 's'} ` +
            'still have invalid prices and no recent scrape-run backup price.',
        );
        for (const product of invalidWithoutBackup.slice(0, 25)) {
            console.warn(`[repair-products] Unrepaired: ${product.name} (${product.id}) price=${product.price}`);
        }
        if (invalidWithoutBackup.length > 25) {
            console.warn(`[repair-products] ...and ${invalidWithoutBackup.length - 25} more`);
        }
    }

    if (!options.write) {
        console.log('[repair-products] Dry run only. Re-run with --write to update Firestore.');
    }
} catch (err) {
    console.error('[repair-products] Failed', err);
    process.exit(1);
}

async function loadPreviousValidPrices(runLimit: number): Promise<Map<string, { price: number; source: RepairCandidate['source'] }>> {
    const prices = new Map<string, { price: number; source: RepairCandidate['source'] }>();
    const runsSnapshot = await db
        .collection('scrape_runs')
        .orderBy('startedAt', 'desc')
        .limit(runLimit)
        .get();

    for (const runDoc of runsSnapshot.docs) {
        const itemsSnapshot = await runDoc.ref.collection('items').get();
        for (const itemDoc of itemsSnapshot.docs) {
            const item = itemDoc.data() as Partial<ScrapeRunItem>;
            const productId = item.productId;
            if (!productId || prices.has(productId)) continue;

            if (isValidPrice(item.baselineProduct?.price)) {
                prices.set(productId, { price: item.baselineProduct.price, source: 'scrape-run-baseline' });
            } else if (isValidPrice(item.scrapedPrice)) {
                prices.set(productId, { price: item.scrapedPrice, source: 'scrape-run-result' });
            }
        }
    }

    return prices;
}

function buildRepairCandidates(
    products: Product[],
    previousPrices: Map<string, { price: number; source: RepairCandidate['source'] }>,
    options: RepairOptions,
): RepairCandidate[] {
    const candidates: RepairCandidate[] = [];

    for (const product of products) {
        const previous = previousPrices.get(product.id);
        const needsRepair = options.all || product.warning === true || !isValidPrice(product.price);
        if (!needsRepair) continue;

        const price = isValidPrice(product.price) ? product.price : previous?.price;
        if (!isValidPrice(price)) continue;

        const source = isValidPrice(product.price) ? 'current' : previous?.source;
        const repairedProduct = applyWarnings(applyCalculations([{
            ...product,
            price,
            provisional_price: null,
        }]))[0];

        candidates.push({
            product,
            repairedProduct,
            source: source ?? 'current',
        });
    }

    return candidates;
}

function buildRepairUpdate(product: Product): Record<string, unknown> {
    return {
        price: product.price,
        provisional_price: null,
        warning: product.warning ?? false,
        price_for_element_gram: product.price_for_element_gram ?? FieldValue.delete(),
        price_per_dose: product.price_per_dose ?? FieldValue.delete(),
        price_per_100_calories: product.price_per_100_calories ?? FieldValue.delete(),
        price_per_1000_calories: product.price_per_1000_calories ?? FieldValue.delete(),
    };
}

function parseArgs(args: string[]): RepairOptions {
    const options: RepairOptions = { write: false, all: false, runLimit: 20, help: false };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        if (arg === '--') {
            continue;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--write') {
            options.write = true;
        } else if (arg === '--all') {
            options.all = true;
        } else if (arg === '--run-limit') {
            options.runLimit = parsePositiveInteger(readValue(args, index, arg), arg);
            index += 1;
        } else if (arg.startsWith('--run-limit=')) {
            options.runLimit = parsePositiveInteger(arg.slice('--run-limit='.length), '--run-limit');
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

function isValidPrice(price: unknown): price is number {
    return typeof price === 'number' && Number.isFinite(price) && price > 0;
}

function printUsage(): void {
    console.log(`Repair product prices, warnings, and computed price fields.

Usage:
  pnpm repair:products
  pnpm repair:products -- --write
  pnpm repair:products -- --all --write

Default mode is a dry run. It targets products with warning=true or invalid prices.
When a product price is invalid, it restores the newest valid baseline/result price
found in recent scrape_runs.

Options:
  --write             Update Firestore
  --all               Recompute every product, not only broken-looking products
  --run-limit <count> Number of recent scrape runs to inspect for backup prices (default: 20)
  --help, -h          Show this help text`);
}