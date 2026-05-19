import type { Page } from 'playwright';
import type { ScraperAction } from '@eiwittens/types';
import { ActionType } from '@eiwittens/types';
import { locate } from '../lib/utils.js';
import { normalizeText } from './validation.js';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1000;
const POST_INTERACTION_SETTLE_MS = 300;

const DEFAULT_COOKIE_BANNERS: Array<{ selectorType: string; value: string }> = [
    { selectorType: 'xpath', value: "//button[contains(text(), 'Accept')]" },
    { selectorType: 'xpath', value: "//button[contains(text(), 'Accept All')]" },
    { selectorType: 'xpath', value: "//button[contains(text(), 'Alles accepteren')]" },
    { selectorType: 'xpath', value: "//button[contains(text(), 'Accepteren')]" },
    { selectorType: 'xpath', value: "//button[contains(@class, 'accept-cookies')]" },
    { selectorType: 'xpath', value: "//button[contains(@id, 'onetrust-accept-btn-handler')]" },
    { selectorType: 'xpath', value: "//button[contains(@id, 'accept')]" },
    { selectorType: 'xpath', value: '//*[@id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll"]' },
    { selectorType: 'xpath', value: "//*[@id='onetrust-accept-btn-handler']" },
    { selectorType: 'xpath', value: '/html/body/div[2]/div/div/div/button[3]' },
];

export async function dismissCookieBanner(
    page: Page,
    extraXPaths: string[] = [],
    timeout = DEFAULT_TIMEOUT_MS,
): Promise<void> {
    const banners = [
        ...extraXPaths.map((v) => ({ selectorType: 'xpath', value: v })),
        ...DEFAULT_COOKIE_BANNERS,
    ];

    // Race all selectors in parallel — click whichever appears first
    try {
        const winner = await Promise.any(
            banners.map(async (banner) => {
                const el = locate(page, banner.selectorType, banner.value).first();
                await el.waitFor({ state: 'visible', timeout });
                return el;
            }),
        );
        await winner.click();
        await page.waitForTimeout(500);
    } catch {
        // No cookie banner found — that's fine
    }
}

export type ActionCallback = (index: number, action: ScraperAction, status: 'start' | 'done' | 'failed', error?: string) => Promise<void> | void;

export async function executeActions(
    page: Page,
    actions: ScraperAction[],
    timeout = DEFAULT_TIMEOUT_MS,
    onAction?: ActionCallback,
): Promise<string> {
    let priceAccumulator = '';

    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        await onAction?.(i, action, 'start');
        try {
            priceAccumulator = await executeWithRetry(page, action, priceAccumulator, timeout);
            await onAction?.(i, action, 'done');
        } catch (err) {
            await onAction?.(i, action, 'failed', (err as Error).message);
            throw err;
        }
    }

    return priceAccumulator;
}

async function executeWithRetry(
    page: Page,
    action: ScraperAction,
    currentPrice: string,
    timeout: number,
): Promise<string> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await executeAction(page, action, currentPrice, timeout);
        } catch (err) {
            lastError = err;
            if (attempt < MAX_RETRIES) {
                await page.waitForTimeout(RETRY_BACKOFF_MS);
            }
        }
    }

    throw lastError;
}

async function executeAction(
    page: Page,
    action: ScraperAction,
    currentPrice: string,
    timeout: number,
): Promise<string> {
    switch (action.type) {
        case ActionType.Click: {
            const el = locate(page, action.selectorType, action.selectorValue).first();
            await el.waitFor({ state: 'visible', timeout });
            await el.click();
            await page.waitForTimeout(POST_INTERACTION_SETTLE_MS);
            return currentPrice;
        }

        case ActionType.SelectOption: {
            const el = locate(page, action.selectorType, action.selectorValue).first();
            await el.waitFor({ state: 'visible', timeout });
            try {
                await el.selectOption({ label: action.optionText });
            } catch (err) {
                const optionValue = await el.evaluate((node, expectedText) => {
                    if (!(node instanceof HTMLSelectElement)) return null;
                    const normalize = (value: string): string => value
                        .normalize('NFKD')
                        .replace(/[\u0300-\u036f]/g, '')
                        .toLowerCase()
                        .replace(/\s+/g, ' ')
                        .trim();
                    const options = Array.from(node.options);
                    const exact = options.find((option) => (
                        normalize(option.label || option.textContent || option.value) === expectedText
                        || normalize(option.value) === expectedText
                    ));
                    const partial = options.find((option) => {
                        const label = normalize(option.label || option.textContent || option.value);
                        return label.includes(expectedText) || expectedText.includes(label);
                    });
                    return (exact ?? partial)?.value ?? null;
                }, normalizeText(action.optionText));

                if (!optionValue) throw err;
                await el.selectOption({ value: optionValue });
            }
            await page.waitForTimeout(POST_INTERACTION_SETTLE_MS);
            return currentPrice;
        }

        case ActionType.Select: {
            let text: string;

            if (action.selectorValue.endsWith('/text()')) {
                // Extract only direct text nodes, skipping child element text
                const parentXPath = action.selectorValue.replace('/text()', '');
                const parentEl = locate(page, action.selectorType, parentXPath).first();
                await parentEl.waitFor({ state: 'attached', timeout });
                text = await parentEl.evaluate((el) =>
                    Array.from(el.childNodes)
                        .filter((n) => n.nodeType === Node.TEXT_NODE)
                        .map((n) => n.textContent?.trim() ?? '')
                        .join(''),
                );
            } else {
                const el = locate(page, action.selectorType, action.selectorValue).first();
                await el.waitFor({ state: 'visible', timeout });
                text = (await el.innerText()).trim();
            }

            // Accumulate price fragments: '12' then '99' → '12.99'
            return currentPrice === '' ? text : `${currentPrice}.${text}`;
        }

        case ActionType.Wait: {
            await page.waitForTimeout(action.duration ?? 2000);
            return currentPrice;
        }
    }
}
