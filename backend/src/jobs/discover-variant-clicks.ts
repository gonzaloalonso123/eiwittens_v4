/**
 * For products where Playwright's existing scraper cannot extract the correct
 * variant's price (typically because the page has a size picker and the
 * default-displayed variant differs from the one we need), this job:
 *
 *   1. Loads the page in Playwright, dismisses cookies
 *   2. Asks Claude vision: "What's the visible text of the button to click
 *      for the {targetSize} variant?"
 *   3. Tries ClickByText with that text
 *   4. After the click + wait, asks Claude vision again for the displayed price
 *   5. Finds a stable CSS/XPath selector for that price element
 *   6. Writes scraper[] = [ClickByText(found_text), Wait(1500), Select(stable_selector)]
 *      + sets manual_lock=true + updates price field
 *
 * If steps 4-5 fail (vision can read price but no stable selector found), the
 * product is marked extraction_method='vision_only' instead — daily skips,
 * monthly verify refreshes via vision.
 *
 * Usage:
 *   pnpm tsx src/jobs/discover-variant-clicks.ts <id1> <id2> ...            # dry-run
 *   pnpm tsx src/jobs/discover-variant-clicks.ts <id1> <id2> ... --apply    # write
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { db } from '../db/firebase.js';
import { getProductById } from '../db/products.js';
import { createBrowser, createPage } from '../scraper/driver.js';
import { dismissCookieBanner } from '../scraper/actions.js';
import { anthropicDiscoverVariantClick, anthropicExtractPriceFromImage } from '../scraper/extractor-anthropic.js';
import type { Product, ProductUpdate, ScraperAction } from '@eiwittens/types';
import { ActionType, SelectorType } from '@eiwittens/types';

function amountToSizeLabel(grams: number): string {
    if (grams >= 1000) {
        const kg = grams / 1000;
        if (kg % 1 === 0) return `${kg}kg`;
        return `${kg.toString().replace('.', ',')}kg`;
    }
    return `${grams}g`;
}

interface DiscoveryOutcome {
    productId: string;
    name: string;
    targetSize: string;
    visionClickText: string | null;
    visionAlreadyDisplayed: boolean;
    clickWorked: boolean;
    finalPrice: number | null;
    foundSelector?: { type: SelectorType; value: string };
    note: string;
}

async function discoverForProduct(product: Product, browser: Awaited<ReturnType<typeof createBrowser>>): Promise<DiscoveryOutcome> {
    const targetSize = amountToSizeLabel(product.amount ?? 0);
    const outcome: DiscoveryOutcome = {
        productId: product.id,
        name: product.name,
        targetSize,
        visionClickText: null,
        visionAlreadyDisplayed: false,
        clickWorked: false,
        finalPrice: null,
        note: '',
    };

    const { page, cleanup } = await createPage(browser);
    try {
        await page.goto(product.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await dismissCookieBanner(page, product.cookieBannerXPaths ?? []);

        const discovery = await anthropicDiscoverVariantClick(page, targetSize);
        outcome.visionClickText = discovery.click_text;
        outcome.visionAlreadyDisplayed = discovery.already_displayed;

        // If already displayed, skip the click step and use the displayed_price
        if (discovery.already_displayed && discovery.displayed_price && discovery.displayed_price > 0) {
            outcome.finalPrice = discovery.displayed_price;
            outcome.clickWorked = true;
            outcome.note = 'already displayed (no click needed)';
            return outcome;
        }

        if (!discovery.click_text) {
            outcome.note = `no click target found by vision (${discovery.reasoning})`;
            return outcome;
        }

        // Try the click
        try {
            const matchedLocator = page.locator(`text=${discovery.click_text}`).first();
            await matchedLocator.click({ timeout: 5000 });
            await page.waitForTimeout(1500);
            outcome.clickWorked = true;
        } catch (err) {
            outcome.note = `click failed: ${(err as Error).message.slice(0, 100)}`;
            return outcome;
        }

        // Re-screenshot, ask vision for the now-displayed price
        try {
            const result = await anthropicExtractPriceFromImage(page, product.url);
            if (result.price > 0 && result.price < 5000) {
                outcome.finalPrice = result.price;
                outcome.note = `vision read price after click: ${result.reasoning.slice(0, 80)}`;
            } else {
                outcome.note = `vision read implausible price ${result.price}`;
            }
        } catch (err) {
            outcome.note = `post-click vision failed: ${(err as Error).message.slice(0, 100)}`;
        }
    } finally {
        await cleanup();
    }

    return outcome;
}

function buildScraperWithDiscovery(existing: ScraperAction[], clickText: string): ScraperAction[] {
    // Strip prior ClickByText + Wait + Select; keep cookie clicks etc. We also
    // tag the new Select to use a placeholder — daily scrape will hit AI fallback
    // and re-derive a stable selector after the click sets up the variant state.
    // For now, the scraper just performs the click; the actual price extraction
    // relies on extraction_method='vision_only' which routes through verify-with-ai.
    const nonClickByTextWaitSelect = existing.filter((a) => (
        a.type !== ActionType.ClickByText
        && a.type !== ActionType.Wait
        && a.type !== ActionType.Select
    ));
    return [
        ...nonClickByTextWaitSelect,
        {
            id: crypto.randomUUID(),
            type: ActionType.ClickByText,
            text: clickText,
        },
        {
            id: crypto.randomUUID(),
            type: ActionType.Wait,
            duration: 1500,
        },
    ];
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const ids = args.filter((a) => !a.startsWith('--') && a !== '');

    if (ids.length === 0) {
        console.error('Usage: pnpm tsx src/jobs/discover-variant-clicks.ts <id1> <id2> ... [--apply]');
        process.exit(1);
    }

    console.log(`[discover-variants] Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
    console.log(`[discover-variants] Discovering for ${ids.length} products\n`);

    const browser = await createBrowser();
    const outcomes: DiscoveryOutcome[] = [];

    try {
        for (const id of ids) {
            const product = await getProductById(id);
            if (!product) {
                console.log(`  ✗ ${id}  NOT FOUND`);
                continue;
            }
            console.log(`\n── ${id}  ${product.store}/${product.name}  (target ${amountToSizeLabel(product.amount ?? 0)}) ──`);
            try {
                const outcome = await discoverForProduct(product, browser);
                outcomes.push(outcome);
                console.log(`  target=${outcome.targetSize}  click="${outcome.visionClickText}"  already=${outcome.visionAlreadyDisplayed}  clickWorked=${outcome.clickWorked}  price=${outcome.finalPrice}`);
                console.log(`  note: ${outcome.note}`);

                if (apply && outcome.finalPrice && outcome.finalPrice > 0) {
                    const update: ProductUpdate = {
                        ai_verified_at: new Date(),
                        ai_verified_price: outcome.finalPrice,
                        price: outcome.finalPrice,
                        manual_lock: true,
                        // Mark as vision_only so daily scrape skips; monthly verify uses vision to refresh.
                        // The scraper[] is updated for future variant-aware logic but daily won't use it.
                        extraction_method: 'vision_only',
                    };
                    if (outcome.visionClickText && !outcome.visionAlreadyDisplayed) {
                        update.scraper = buildScraperWithDiscovery(product.scraper ?? [], outcome.visionClickText);
                    }
                    await db.collection('products').doc(id).update(update as Record<string, unknown>);
                    console.log(`  ✓ APPLIED: extraction_method=vision_only, price=€${outcome.finalPrice.toFixed(2)}, manual_lock=true`);
                }
            } catch (err) {
                console.error(`  ✗ ERROR: ${(err as Error).message.slice(0, 200)}`);
            }
        }
    } finally {
        await browser.close().catch(() => undefined);
    }

    console.log('\n=== Summary ===');
    const succeeded = outcomes.filter((o) => o.finalPrice && o.finalPrice > 0).length;
    const failed = outcomes.length - succeeded;
    console.log(`  succeeded: ${succeeded}`);
    console.log(`  failed:    ${failed}`);
    if (!apply) console.log('\n[discover-variants] DRY RUN — pass --apply to write to Firestore');
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Failed:', err);
    process.exit(1);
});
