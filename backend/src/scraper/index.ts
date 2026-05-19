import { createDriver, createPage } from './driver.js';
import { dismissCookieBanner, executeActions } from './actions.js';
import { anthropicExtractPrice as aiExtractPrice } from './extractor-anthropic.js';
import { extractFreePrice, NoFreeExtractionAvailable, type FreeExtractionMethod } from './free-extractor.js';
import { takeScreenshot } from './helpers.js';
import { isHighConfidenceValidation, validateScrapeResult } from './validation.js';
import { cleanPrice } from '../lib/utils.js';
import { updateProduct } from '../db/products.js';
import type { Product, ScrapeValidationResult, ScraperAction, ExtractionMethod } from '@eiwittens/types';
import { ActionType } from '@eiwittens/types';
import type { Browser, Page } from 'playwright';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScrapeResult {
    price: number;
    aiUsed: boolean;
    validation?: ScrapeValidationResult;
}

export interface ScrapeOptions {
    persistFixedScraper?: boolean;
}

export interface TestScrapeStepEvent {
    step: string;
    message: string;
    index?: number;
    action?: ScraperAction;
    screenshot?: string | null;
}

export interface TestScrapeResultEvent {
    success: boolean;
    price: number;
    screenshot: string | null;
    aiFixed: boolean;
    validation?: ScrapeValidationResult;
    fixedActions?: ScraperAction[];
    message?: string;
    error?: string;
}

export type TestScrapeEvent =
    | { type: 'step'; data: TestScrapeStepEvent }
    | { type: 'result'; data: TestScrapeResultEvent };

type OnEvent = (event: TestScrapeEvent) => void;

// ── Helpers ──────────────────────────────────────────────────────────────────

function emitStep(onEvent: OnEvent, data: TestScrapeStepEvent): void {
    onEvent({ type: 'step', data });
}

function emitResult(onEvent: OnEvent, data: TestScrapeResultEvent): void {
    onEvent({ type: 'result', data });
}

// ── Test scrape with progress ────────────────────────────────────────────────

export async function testScrapeWithProgress(
    productOrUrl: Product | string,
    actions: ScraperAction[],
    cookieBannerXPaths: string[],
    onEvent: OnEvent,
): Promise<void> {
    const { page, cleanup } = await createDriver();
    const product = typeof productOrUrl === 'string' ? undefined : productOrUrl;
    const url = typeof productOrUrl === 'string' ? productOrUrl : productOrUrl.url;

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

        if (!noActions) try {
            const raw = await executeActions(page, actions, undefined, async (index, action, status, error) => {
                if (status === 'start') {
                    emitStep(onEvent, {
                        step: 'action',
                        index,
                        action,
                        message: `Executing action ${index + 1}/${actions.length}: ${action.type}`,
                    });
                } else if (status === 'done') {
                    emitStep(onEvent, {
                        step: 'action_done',
                        index,
                        message: `Action ${index + 1} completed`,
                        screenshot: await takeScreenshot(page),
                    });
                } else if (status === 'failed') {
                    emitStep(onEvent, {
                        step: 'action_failed',
                        index,
                        message: `Action ${index + 1} failed: ${error}`,
                        screenshot: await takeScreenshot(page),
                    });
                }
            });

            const price = cleanPrice(raw);
            const validation = await validateScrapeResult(page, product, price);

            if (validation.ok) {
                emitResult(onEvent, {
                    success: true,
                    price,
                    screenshot: await takeScreenshot(page),
                    aiFixed: false,
                    validation,
                    message: formatValidationSummary(validation),
                });
            } else {
                actionsFailed = true;
                actionError = `Validation failed: ${formatValidationSummary(validation)}`;
                emitStep(onEvent, {
                    step: 'validation_failed',
                    message: actionError,
                    screenshot: await takeScreenshot(page),
                });
            }
        } catch (err) {
            actionsFailed = true;
            actionError = (err as Error).message;
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
                const replay = aiResult.fixedScraper.length > 0
                    ? await replayActionsForValidation(page, url, mergedActions, cookieBannerXPaths, product)
                    : {
                        price: aiResult.price,
                        validation: await validateScrapeResult(page, product, aiResult.price),
                    };
                const canPersistFix = aiResult.fixedScraper.length > 0 && isHighConfidenceValidation(replay.validation);

                console.log('AI fallback result:', {
                    mergedActions,
                    fixedScraper: aiResult.fixedScraper,
                    validation: replay.validation,
                    canPersistFix,
                });

                emitResult(onEvent, {
                    success: replay.validation.ok,
                    price: replay.price,
                    screenshot: await takeScreenshot(page),
                    aiFixed: true,
                    validation: replay.validation,
                    fixedActions: canPersistFix ? mergedActions : undefined,
                    message: canPersistFix
                        ? 'AI found a high-confidence selector after replay validation'
                        : `AI found a price, but fix was not trusted enough to save: ${formatValidationSummary(replay.validation)}`,
                });
            } catch (aiErr) {
                emitResult(onEvent, {
                    success: false,
                    price: 0,
                    screenshot: await takeScreenshot(page),
                    aiFixed: false,
                    error: `Actions failed: ${actionError}. AI also failed: ${(aiErr as Error).message}`,
                });
            }
        }
    } catch (err) {
        emitResult(onEvent, {
            success: false,
            price: 0,
            screenshot: null,
            aiFixed: false,
            error: (err as Error).message,
        });
    } finally {
        await cleanup();
    }
}

// ── Production scrape (batch pipeline) ───────────────────────────────────────

export async function scrapeProduct(product: Product, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const { page, cleanup } = await createDriver();

    try {
        return await scrapeProductOnPage(product, page, options);
    } finally {
        await cleanup();
    }
}

export async function scrapeProductWithBrowser(
    product: Product,
    browser: Browser,
    options: ScrapeOptions = {},
): Promise<ScrapeResult> {
    const { page, cleanup } = await createPage(browser);

    try {
        return await scrapeProductOnPage(product, page, options);
    } finally {
        await cleanup();
    }
}

// Mapping from product.extraction_method to the Free Extractor's internal method
const FREE_METHOD_MAP: Record<string, FreeExtractionMethod> = {
    free_jsonld: 'jsonld',
    free_shopify: 'shopify_json',
    free_og: 'og',
    free_microdata: 'microdata',
};

async function scrapeProductOnPage(
    product: Product,
    page: import('playwright').Page,
    options: ScrapeOptions,
): Promise<ScrapeResult> {
    let price = 0;
    let aiUsed = false;
    let validation: ScrapeValidationResult | undefined;

    const method: ExtractionMethod = product.extraction_method ?? 'playwright';

    // ── Layer 1: Feed-managed products — price comes from feed import job, no scrape ──
    if (method === 'feed_awin') {
        console.log(`[scraper] "${product.name}" is feed_awin — skipping scrape (price managed by feed import)`);
        return { price: product.price, aiUsed: false, validation: undefined };
    }

    // ── Layer 0: Free Extractor for products flagged with a free_* extraction method ──
    if (method.startsWith('free_')) {
        try {
            const preferMethod = FREE_METHOD_MAP[method];
            const browser = page.context().browser() ?? undefined;
            const free = await extractFreePrice(product.url, {
                preferMethod,
                playwrightBrowser: browser,
                amountGrams: product.amount,
            });
            price = free.price;
            validation = await validateScrapeResult(page, product, price);
            console.log(`[scraper] Layer 0 (${method}) succeeded for "${product.name}" — price=${price} via ${free.method}/${free.fetch_method}`);
            return { price, aiUsed: false, validation };
        } catch (err) {
            const msg = (err as Error).message;
            console.warn(`[scraper] Layer 0 (${method}) failed for "${product.name}": ${msg}. Falling back to Playwright + XPath.`);
            // Fall through to Playwright pipeline below
        }
    }

    // ── Layer 1/2: existing Playwright + XPath flow ──
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
        validation = await validateScrapeResult(page, product, price);
        if (!validation.ok) {
            throw new Error(`Validation failed: ${formatValidationSummary(validation)}`);
        }
    } catch (domError) {
        console.warn(
            `[scraper] DOM extraction or validation failed for "${product.name}", trying AI fallback.`,
            (domError as Error).message,
        );
        try {
            await page.goto(product.url, { waitUntil: 'domcontentloaded' });
            await dismissCookieBanner(page, product.cookieBannerXPaths ?? []);

            const aiResult = await aiExtractPrice(page, product.url);
            const nonSelectActions = product.scraper.filter((a) => a.type !== ActionType.Select);
            const fixedActions = [...nonSelectActions, ...aiResult.fixedScraper];
            const replay = aiResult.fixedScraper.length > 0
                ? await replayActionsForValidation(page, product.url, fixedActions, product.cookieBannerXPaths ?? [], product)
                : {
                    price: aiResult.price,
                    validation: await validateScrapeResult(page, product, aiResult.price),
                };

            if (!isHighConfidenceValidation(replay.validation)) {
                validation = replay.validation;
                console.warn(
                    `[scraper] AI fallback rejected for "${product.name}" — ${formatValidationSummary(replay.validation)}`,
                );
                price = 0;
            } else {
                price = replay.price;
                validation = replay.validation;
                aiUsed = true;
                console.log(`[scraper] AI fallback succeeded for "${product.name}" — price=${price}`);

                // Persist only when the discovered selector survives a clean replay validation,
                // AND the product isn't manually locked against AI overwrite.
                if (aiResult.fixedScraper.length > 0 && options.persistFixedScraper !== false) {
                    if (product.manual_lock) {
                        console.log(`[scraper] AI found high-confidence fix for "${product.name}" but manual_lock=true — skipping persist`);
                    } else {
                        await updateProduct(product.id, { scraper: fixedActions });
                        console.log(`[scraper] Scraper auto-fixed for "${product.name}" — high-confidence selector persisted`);
                    }
                }
            }
        } catch (aiError) {
            console.error(
                `[scraper] AI fallback also failed for "${product.name}":`,
                (aiError as Error).message,
            );
        }
    }

    console.log(
        `[scraper] Final result for "${product.name}": price=${price} aiUsed=${aiUsed}` +
        (validation ? ` validation=${validation.confidence}/${validation.score}` : ''),
    );

    return { price, aiUsed, validation };
}

async function replayActionsForValidation(
    page: import('playwright').Page,
    url: string,
    actions: ScraperAction[],
    cookieBannerXPaths: string[],
    product: Product | undefined,
): Promise<{ price: number; validation: ScrapeValidationResult }> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await dismissCookieBanner(page, cookieBannerXPaths);
    const raw = await executeActions(page, actions);
    const price = cleanPrice(raw);
    const validation = await validateScrapeResult(page, product, price);
    return { price, validation };
}

function formatValidationSummary(validation: ScrapeValidationResult): string {
    const details = [...validation.evidence, ...validation.reasons].slice(0, 4).join('; ');
    return `${validation.confidence} confidence (${validation.score}/100)${details ? ` — ${details}` : ''}`;
}
