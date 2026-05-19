// Test multiple selectors on a Bulk product page to see which returns correct price
import { createBrowser } from '../scraper/driver.js';
import { dismissCookieBanner } from '../scraper/actions.js';

const url = process.argv[2] || 'https://www.bulk.com/nl/products/creatine-monohydrate/bpb-cmon-0000';
const expectedPrice = process.argv[3] || '22.99';

console.log(`Testing: ${url} (expecting €${expectedPrice})`);
const browser = await createBrowser();
try {
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        locale: 'nl-NL',
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismissCookieBanner(page, []);
    await page.waitForTimeout(2000);

    const selectorsToTest = [
        '.dropin-price--default',
        '.pdp-product__price-special .dropin-price',
        '.pdp-product__price-special',
        '.dropin-price',
        '[data-testid="product-price"]',
        '.product-price',
        '[itemprop="price"]',
    ];

    for (const sel of selectorsToTest) {
        try {
            const count = await page.locator(sel).count();
            if (count === 0) {
                console.log(`  ${sel.padEnd(50)} -> not found`);
                continue;
            }
            for (let i = 0; i < Math.min(count, 3); i++) {
                const text = await page.locator(sel).nth(i).innerText({ timeout: 2000 }).catch(() => '(no text)');
                console.log(`  ${sel.padEnd(50)} [${i}] -> "${text.slice(0, 60)}"`);
            }
        } catch (e) {
            console.log(`  ${sel.padEnd(50)} -> error: ${(e as Error).message.slice(0, 60)}`);
        }
    }

    console.log('\n--- size buttons ---');
    const sizeButtons = await page.locator('button, [role="button"]').all();
    for (const b of sizeButtons.slice(0, 20)) {
        const text = await b.innerText().catch(() => '');
        if (text && /\d+\s*(g|kg|gr)/i.test(text)) {
            console.log(`  button: "${text.slice(0, 80)}"`);
        }
    }

    await context.close();
} finally {
    await browser.close();
}
process.exit(0);
