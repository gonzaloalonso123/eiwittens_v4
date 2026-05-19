// Test ClickByText on a Bulk product page
import { createBrowser } from '../scraper/driver.js';
import { dismissCookieBanner, executeActions } from '../scraper/actions.js';
import { ActionType, SelectorType, type ScraperAction } from '@eiwittens/types';

const url = process.argv[2] || 'https://www.bulk.com/nl/products/creatine-monohydrate/bpb-cmon-0000';
const sizeText = process.argv[3] || '1 kg';

console.log(`Testing ClickByText on: ${url}`);
console.log(`Target size: "${sizeText}"`);

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

    // Inspect possible size selectors first
    console.log('\n--- Searching for size-like elements ---');
    const broaderScope = 'button, a, label, [role="button"], [role="radio"], [role="option"], input[type="radio"], div[class*="variant"], div[class*="size"], div[class*="weight"]';
    const candidates = await page.locator(broaderScope).all();
    console.log(`Found ${candidates.length} candidates in scope`);
    let found = 0;
    for (const el of candidates) {
        const text = await el.innerText({ timeout: 500 }).catch(() => '');
        if (text && /\b\d+\s*(g|kg|gr|gram)\b/i.test(text)) {
            const tag = await el.evaluate((e) => e.tagName).catch(() => '?');
            console.log(`  <${tag}> "${text.replace(/\s+/g, ' ').slice(0, 80)}"`);
            found++;
            if (found > 10) break;
        }
    }

    // Run actions
    console.log('\n--- Running actions: ClickByText + Wait + Select ---');
    const actions: ScraperAction[] = [
        { id: 'a1', type: ActionType.ClickByText, text: sizeText },
        { id: 'a2', type: ActionType.Wait, duration: 1500 },
        { id: 'a3', type: ActionType.Select, selectorType: SelectorType.Css, selectorValue: '.dropin-price--default' },
    ];
    try {
        const result = await executeActions(page, actions);
        console.log(`\n✓ SUCCESS: extracted price="${result}"`);
    } catch (err) {
        console.log(`\n✗ FAIL: ${(err as Error).message}`);
    }

    await context.close();
} finally {
    await browser.close();
}
process.exit(0);
