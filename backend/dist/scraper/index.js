import { createDriver } from './driver.js';
import { dismissCookieBanner, executeActions } from './actions.js';
import { aiExtractPrice } from './extractor.js';
import { cleanPrice } from '../lib/utils.js';
import { updateProduct } from '../db/products.js';
import { ActionType } from '@eiwittens/types';
// ── Helpers ──────────────────────────────────────────────────────────────────
async function takeScreenshot(page) {
    try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
        return buf.toString('base64');
    }
    catch {
        return null;
    }
}
function emitStep(onEvent, data) {
    onEvent({ type: 'step', data });
}
function emitResult(onEvent, data) {
    onEvent({ type: 'result', data });
}
// ── Test scrape with progress ────────────────────────────────────────────────
export async function testScrapeWithProgress(url, actions, cookieBannerXPaths, onEvent) {
    const { page, cleanup } = await createDriver();
    try {
        // Navigate
        emitStep(onEvent, { step: 'navigating', message: `Navigating to ${url}` });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        emitStep(onEvent, { step: 'navigated', message: 'Page loaded', screenshot: await takeScreenshot(page) });
        // Cookie banner
        emitStep(onEvent, { step: 'cookies', message: 'Dismissing cookie banner...' });
        await dismissCookieBanner(page, cookieBannerXPaths);
        emitStep(onEvent, { step: 'cookies_done', message: 'Cookie banner handled', screenshot: await takeScreenshot(page) });
        // Execute actions with per-action progress
        let actionError = '';
        let actionsFailed = false;
        const noActions = actions.length === 0;
        if (noActions) {
            emitStep(onEvent, { step: 'ai_fixing', message: 'No actions configured. Using AI to find price...' });
        }
        if (!noActions)
            try {
                const raw = await executeActions(page, actions, undefined, async (index, action, status, error) => {
                    if (status === 'start') {
                        emitStep(onEvent, {
                            step: 'action',
                            index,
                            action,
                            message: `Executing action ${index + 1}/${actions.length}: ${action.type}`,
                        });
                    }
                    else if (status === 'done') {
                        emitStep(onEvent, {
                            step: 'action_done',
                            index,
                            message: `Action ${index + 1} completed`,
                            screenshot: await takeScreenshot(page),
                        });
                    }
                    else if (status === 'failed') {
                        emitStep(onEvent, {
                            step: 'action_failed',
                            index,
                            message: `Action ${index + 1} failed: ${error}`,
                            screenshot: await takeScreenshot(page),
                        });
                    }
                });
                const price = cleanPrice(raw);
                emitResult(onEvent, {
                    success: price > 0,
                    price,
                    screenshot: await takeScreenshot(page),
                    aiFixed: false,
                });
            }
            catch (err) {
                actionsFailed = true;
                actionError = err.message;
            }
        // AI fallback
        if (noActions || actionsFailed) {
            if (actionsFailed) {
                emitStep(onEvent, {
                    step: 'ai_fixing',
                    message: 'Actions failed. Attempting AI fix...',
                });
                // Re-navigate so AI sees a clean page (failed actions may have corrupted DOM)
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                await dismissCookieBanner(page, cookieBannerXPaths);
            }
            try {
                const aiResult = await aiExtractPrice(page, url);
                // Merge: keep non-Select actions (Click/Wait/SelectOption) from original,
                // replace only the Select actions with the AI-found selector(s)
                const nonSelectActions = actions.filter((a) => a.type !== ActionType.Select);
                const mergedActions = [...nonSelectActions, ...aiResult.fixedScraper];
                console.log('AI fixed the scraper! Merged actions:', mergedActions, aiResult.fixedScraper);
                emitResult(onEvent, {
                    success: aiResult.price > 0,
                    price: aiResult.price,
                    screenshot: await takeScreenshot(page),
                    aiFixed: true,
                    fixedActions: mergedActions,
                    message: 'AI found a working selector',
                });
            }
            catch (aiErr) {
                emitResult(onEvent, {
                    success: false,
                    price: 0,
                    screenshot: await takeScreenshot(page),
                    aiFixed: false,
                    error: `Actions failed: ${actionError}. AI also failed: ${aiErr.message}`,
                });
            }
        }
    }
    catch (err) {
        emitResult(onEvent, {
            success: false,
            price: 0,
            screenshot: null,
            aiFixed: false,
            error: err.message,
        });
    }
    finally {
        await cleanup();
    }
}
// ── Production scrape (batch pipeline) ───────────────────────────────────────
export async function scrapeProduct(product) {
    const { page, cleanup } = await createDriver();
    let price = 0;
    let aiUsed = false;
    try {
        console.log(`[scraper] Navigating to ${product.url}`);
        await page.goto(product.url, { waitUntil: 'domcontentloaded' });
        const title = await page.title();
        const currentUrl = page.url();
        console.log(`[scraper] Page loaded — title="${title}" url=${currentUrl}`);
        await dismissCookieBanner(page, product.cookieBannerXPaths ?? []);
        console.log(`[scraper] Cookie banner dismissed (or not present)`);
        try {
            const raw = await executeActions(page, product.scraper);
            price = cleanPrice(raw);
        }
        catch (domError) {
            console.warn(`[scraper] DOM extraction failed for "${product.name}", trying AI fallback.`, domError.message);
            try {
                const aiResult = await aiExtractPrice(page, product.url);
                price = aiResult.price;
                aiUsed = true;
                console.log(`[scraper] AI fallback succeeded for "${product.name}" — price=${price}`);
                // Persist the discovered selector so future scrapes don't need AI
                if (aiResult.fixedScraper.length > 0) {
                    await updateProduct(product.id, { ...product, scraper: aiResult.fixedScraper });
                    console.log(`[scraper] Scraper auto-fixed for "${product.name}" — selector persisted`);
                }
            }
            catch (aiError) {
                console.error(`[scraper] AI fallback also failed for "${product.name}":`, aiError.message);
            }
        }
        console.log(`[scraper] Final result for "${product.name}": price=${price} aiUsed=${aiUsed}`);
    }
    finally {
        await cleanup();
    }
    return { price, aiUsed };
}
//# sourceMappingURL=index.js.map