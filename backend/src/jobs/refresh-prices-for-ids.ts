/**
 * Scrape a specific list of product IDs locally and write the resulting price
 * back to Firestore (or dry-run print).
 *
 * Reusable for any "I just edited these N scrapers, refresh their price field"
 * scenario without running the full daily pipeline.
 *
 * Usage:
 *   pnpm tsx src/jobs/refresh-prices-for-ids.ts <id1> <id2> ...           # dry-run
 *   pnpm tsx src/jobs/refresh-prices-for-ids.ts <id1> <id2> ... --apply   # write to Firestore
 */
import 'dotenv/config';
import { db } from '../db/firebase.js';
import { getProductById } from '../db/products.js';
import { createBrowser } from '../scraper/driver.js';
import { scrapeProductWithBrowser } from '../scraper/index.js';

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const ids = args.filter((a) => !a.startsWith('--') && a !== '');

    if (ids.length === 0) {
        console.error('Usage: pnpm tsx src/jobs/refresh-prices-for-ids.ts <id1> <id2> ... [--apply]');
        process.exit(1);
    }

    console.log(`[refresh-prices] Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
    console.log(`[refresh-prices] Refreshing ${ids.length} products\n`);

    const browser = await createBrowser();
    let updated = 0;
    let skipped = 0;

    try {
        for (const id of ids) {
            const product = await getProductById(id);
            if (!product) {
                console.log(`  ✗ ${id}  NOT FOUND`);
                skipped += 1;
                continue;
            }
            try {
                const result = await scrapeProductWithBrowser(product, browser, { persistFixedScraper: false });
                const old = product.price ?? 0;
                console.log(`  ${result.price > 0 ? '✓' : '✗'} ${id}  ${(product.store ?? '').padEnd(20)} ${product.name?.slice(0, 50).padEnd(50)} €${old.toFixed(2).padStart(7)} → €${result.price.toFixed(2).padStart(7)}${result.aiUsed ? ' (AI fallback)' : ''}`);
                if (apply && result.price > 0) {
                    await db.collection('products').doc(id).update({ price: result.price });
                    updated += 1;
                } else if (apply) {
                    skipped += 1;
                } else {
                    skipped += 1;
                }
            } catch (err) {
                console.log(`  ✗ ${id}  ${product.store}/${product.name?.slice(0, 50)}  ERROR: ${(err as Error).message.slice(0, 100)}`);
                skipped += 1;
            }
        }
    } finally {
        await browser.close().catch(() => undefined);
    }

    console.log('');
    console.log(`[refresh-prices] ${apply ? `Done. updated=${updated} skipped=${skipped}` : 'DRY RUN — pass --apply to write prices'}`);
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Failed:', err);
    process.exit(1);
});
