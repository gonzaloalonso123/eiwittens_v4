// Spot-check: run ClickByText fix on a hand-picked set of Bulk products
// that the audit flagged as "xpath_broken" (their current scraper returns
// the cheapest variant, not the intended size).
//
// Prints: product name | URL | expected size | scraped price | GG stored
// User opens URL in browser, clicks the matching size, eyeballs price.

import { createBrowser, createPage } from '../scraper/driver.js';
import { dismissCookieBanner, executeActions } from '../scraper/actions.js';
import { ActionType, SelectorType, type ScraperAction } from '@eiwittens/types';
import { cleanPrice } from '../lib/utils.js';

const BACKEND_API = 'https://eiwittens-backend-16129604687.europe-west4.run.app';

interface Test {
    name: string;
    productId: string;
    sizeText: string;
    expectedGgPrice: number;
}

// Picked from the bulk-xpath-audit.json `xpath_broken` list
async function buildTestList(): Promise<Test[]> {
    const products = await fetch(`${BACKEND_API}/products?type=MINIMAL`).then((r) => r.json()) as Array<{
        id: string; name: string; store: string; price: number; amount?: number;
    }>;
    const targets = [
        'Clear Whey Isolate | 2kg',
        'Pure Whey Protein | 5kg',
        'Mass Gainer | 5kg',
        'Creatine Monohydrate | 1kg',
    ];
    const out: Test[] = [];
    for (const t of targets) {
        const p = products.find((x) => x.store === 'Bulk' && x.name === t);
        if (!p) continue;
        const sizeText = t.split('|').pop()!.trim();
        out.push({ name: p.name, productId: p.id, sizeText, expectedGgPrice: p.price });
    }
    return out;
}

const tests = await buildTestList();
console.log(`[spot-check] Running ClickByText fix on ${tests.length} Bulk products`);
console.log('');

const browser = await createBrowser();
try {
    for (const t of tests) {
        const full = await fetch(`${BACKEND_API}/products/${t.productId}`).then((r) => r.json()) as { url: string; cookieBannerXPaths?: string[] };
        const { page, cleanup } = await createPage(browser);
        try {
            await page.goto(full.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await dismissCookieBanner(page, full.cookieBannerXPaths ?? []);

            // Run NEW action sequence: ClickByText + Wait + Select
            const actions: ScraperAction[] = [
                { id: 'a1', type: ActionType.ClickByText, text: t.sizeText },
                { id: 'a2', type: ActionType.Wait, duration: 1500 },
                { id: 'a3', type: ActionType.Select, selectorType: SelectorType.Css, selectorValue: '.dropin-price--default' },
            ];

            let scraped: number | string = 'FAIL';
            try {
                const raw = await executeActions(page, actions);
                scraped = cleanPrice(raw);
            } catch (err) {
                scraped = `FAIL: ${(err as Error).message.slice(0, 80)}`;
            }

            const finalUrl = page.url();
            console.log(`---`);
            console.log(`${t.name}`);
            console.log(`  Target size: "${t.sizeText}"`);
            console.log(`  GG stored:   €${t.expectedGgPrice}`);
            console.log(`  Live scrape: ${typeof scraped === 'number' ? `€${scraped}` : scraped}`);
            console.log(`  URL:         ${finalUrl}`);
            console.log('');
        } finally {
            await cleanup();
        }
    }
} finally {
    await browser.close();
}

process.exit(0);
