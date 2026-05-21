import Anthropic from '@anthropic-ai/sdk';
import type { Page } from 'playwright';
import type { ScraperAction } from '@eiwittens/types';
import { ActionType, SelectorType } from '@eiwittens/types';
import { cleanPrice, locate } from '../lib/utils.js';
import { stripHtml, truncateHtml } from './helpers.js';

let _client: Anthropic | null = null;
function getClient(): Anthropic {
    if (_client) return _client;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic({ apiKey });
    return _client;
}

const MODEL = 'claude-haiku-4-5-20251001';
const VISION_MODEL = 'claude-haiku-4-5-20251001';
const MAX_HTML_CHARS = 40_000;
const MAX_TOKENS = 800;
const SELECTOR_TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000];

async function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** Wrap an Anthropic request with retry/backoff on 429 + 5xx. */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const status = (err as { status?: number }).status ?? 0;
            const isRetryable = status === 429 || (status >= 500 && status < 600);
            if (!isRetryable || attempt === RETRY_DELAYS_MS.length) throw err;
            const delay = RETRY_DELAYS_MS[attempt];
            console.warn(`[anthropic-extractor] ${label} attempt ${attempt + 1} got ${status}, sleeping ${delay}ms`);
            await sleep(delay);
        }
    }
    throw lastError;
}

const SYSTEM_PROMPT = `You are an expert web scraper for Dutch e-commerce supplement shops. Your task is to locate the main product price on a page and return selectors that will remain stable over time.

Selector quality rules (in order of preference):
1. Schema.org / microdata: [itemprop="price"], [property="product:price:amount"]
2. Semantic data attributes: [data-price], [data-product-price], [data-automation="price"]
3. Stable IDs: #product-price, #price
4. Stable non-positional class selectors (e.g. .price__current, .product-price)
5. AVOID: positional XPath (//div[3]/span[2]), generated class names (e.g. _3xQ9z, css-1abc2de), nth-child chains

CRITICAL price-picking rules:
- If both a sale price and an original (strikethrough) price are present, ALWAYS return the CURRENT price the customer pays (the sale price), not the strikethrough.
- If multiple product variants are visible (sizes, flavors), return the price of the variant that appears SELECTED, or the default/first if none is selected.
- If the price is split across DOM nodes (e.g. "€12" and "99" in separate spans), return the FULL price as text and a selector for the parent that contains both.
- Ignore "from €X", "starting at €X" — find the actual displayed price.
- Currency is always EUR (€). If you see a number without currency symbol but it's clearly the product price, return it.

Return ONLY valid JSON — no markdown, no preamble.`;

export interface AnthropicExtractResult {
    price: number;
    fixedScraper: ScraperAction[];
    rawAiPrice: string;
    candidatesTried: number;
}

export async function anthropicExtractPrice(page: Page, url: string): Promise<AnthropicExtractResult> {
    const rawHtml: string = await page.evaluate(() => document.documentElement.outerHTML);
    const cleanedHtml = truncateHtml(stripHtml(rawHtml), MAX_HTML_CHARS);

    const response = await withRetry('html-extract', () => getClient().messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
            {
                role: 'user',
                content: `Find the main product price on this page. Return JSON in EXACTLY this shape (no other keys):
{
  "price": "<price text as shown on page, e.g. \\"€19,99\\" or \\"19.99\\">",
  "candidates": [
    { "selectorType": "css", "selector": "<most stable selector>" },
    { "selectorType": "css", "selector": "<second choice>" },
    { "selectorType": "xpath", "selector": "<xpath fallback>" }
  ]
}

URL: ${url}

HTML:
${cleanedHtml}`,
            },
        ],
    }));

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Anthropic returned no text content');
    }

    const content = textBlock.text.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Anthropic returned non-JSON response: ${content.slice(0, 200)}`);

    const parsed = JSON.parse(jsonMatch[0]) as {
        price: string;
        candidates: Array<{ selectorType: string; selector: string }>;
    };

    let candidatesTried = 0;
    for (const candidate of parsed.candidates ?? []) {
        candidatesTried++;
        try {
            const liveText = await locate(page, candidate.selectorType, candidate.selector)
                .first()
                .innerText({ timeout: SELECTOR_TIMEOUT_MS });
            const price = cleanPrice(liveText);

            if (price > 0) {
                return {
                    price,
                    rawAiPrice: parsed.price,
                    candidatesTried,
                    fixedScraper: [
                        {
                            id: crypto.randomUUID(),
                            type: ActionType.Select,
                            selectorType: candidate.selectorType as SelectorType,
                            selectorValue: candidate.selector,
                        },
                    ],
                };
            }
        } catch {
            // try next candidate
        }
    }

    const aiPrice = cleanPrice(parsed.price ?? '');
    if (aiPrice > 0) {
        const provenSelector = await findSelectorForPrice(page, parsed.price);
        if (provenSelector) {
            return {
                price: aiPrice,
                rawAiPrice: parsed.price,
                candidatesTried,
                fixedScraper: [
                    {
                        id: crypto.randomUUID(),
                        type: ActionType.Select,
                        selectorType: provenSelector.selectorType,
                        selectorValue: provenSelector.selector,
                    },
                ],
            };
        }
        return { price: aiPrice, rawAiPrice: parsed.price, candidatesTried, fixedScraper: [] };
    }

    throw new Error(`Anthropic could not extract a valid price (raw="${parsed.price}", tried ${candidatesTried} selectors)`);
}

// ── Vision fallback (Layer 3) ────────────────────────────────────────────────
//
// When HTML extraction fails or returns implausible values, we fall back to
// asking Claude to read the price visually from a screenshot. This catches:
//   - Heavily JavaScript-rendered prices that don't appear in static HTML
//   - Prices embedded in <canvas> or images
//   - Pages where HTML parsing hallucinates SKUs/IDs as prices
//
// Important caveat: vision can read the price but generally cannot derive a
// stable selector. Products that succeed *only* via vision should be marked
// with `extraction_method: 'vision_only'` so the daily scrape skips them; the
// monthly verify-with-ai job is responsible for refreshing their price.

const VISION_SYSTEM_PROMPT = `You are an expert at reading product prices from web page screenshots of Dutch e-commerce supplement shops.

Rules:
- Return ONLY the price the customer pays today (the sale price, not the strikethrough/was price).
- Currency is EUR (€). If you see "€19,99" or "19,99 EUR" return 19.99 as a number.
- If multiple variants/sizes are visible, return the price of the variant that appears SELECTED, or the default/first if none is selected.
- Ignore "from €X", "vanaf €X", "starting at €X" labels — find the actual displayed price.
- If you cannot see a clear price for a single product on this page, return null.

Return ONLY valid JSON, no markdown:
{ "price": <number or null>, "reasoning": "<short explanation>" }`;

export interface AnthropicVisionResult {
    price: number;
    reasoning: string;
}

/**
 * Read the product's price visually from a viewport screenshot of the current page.
 * Returns price > 0 on success; throws on extraction failure.
 *
 * Caller should ensure the page is already navigated + cookie-banner-dismissed.
 */
export async function anthropicExtractPriceFromImage(page: Page, url: string): Promise<AnthropicVisionResult> {
    // Capture viewport — full-page screenshots tend to push the price below the
    // model's effective resolution window. Viewport (above the fold) is usually
    // where the price lives on supplement product pages.
    const buffer = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
    const base64 = buffer.toString('base64');

    const response = await withRetry('vision-extract', () => getClient().messages.create({
        model: VISION_MODEL,
        max_tokens: 300,
        system: VISION_SYSTEM_PROMPT,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
                    },
                    {
                        type: 'text',
                        text: `URL: ${url}\n\nExtract the current product price.`,
                    },
                ],
            },
        ],
    }));

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
        throw new Error('Vision returned no text content');
    }
    const text = textBlock.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Vision returned non-JSON: ${text.slice(0, 200)}`);
    const parsed = JSON.parse(jsonMatch[0]) as { price: number | null; reasoning?: string };

    if (parsed.price === null || typeof parsed.price !== 'number' || !Number.isFinite(parsed.price) || parsed.price <= 0) {
        throw new Error(`Vision did not return a usable price (raw=${JSON.stringify(parsed)})`);
    }

    return { price: parsed.price, reasoning: parsed.reasoning ?? '' };
}

// ── Vision-driven variant selection discovery ────────────────────────────────
//
// For multi-variant product pages where Playwright cannot derive the right
// "click this size button" action automatically, ask Claude vision to look at
// the page and identify the exact button text needed for a target size.
// Returns enough info to assemble a [ClickByText, Wait, Select] scraper.

const VARIANT_DISCOVERY_PROMPT = `You are a web scraping assistant. Look at this product page screenshot.

The user needs the price for a specific size/variant of this product. Examine
the variant selector elements (size buttons, dropdowns, radio options, swatches).
Identify whether the target variant is already displayed or whether a button
must be clicked.

Return ONLY valid JSON, no markdown, no preamble. Schema:
{
  "already_displayed": <bool>,          // Is the target size's price currently shown?
  "click_text": <string|null>,          // Exact visible text of the button/option to click for the target size (e.g. "5kg", "4 KG", "2,5kg"). Null if no click is needed or none was found.
  "displayed_price": <number|null>,     // The price as currently shown for the target variant, if visible.
  "reasoning": <string>                 // Short explanation.
}`;

export interface VariantDiscoveryResult {
    already_displayed: boolean;
    click_text: string | null;
    displayed_price: number | null;
    reasoning: string;
}

export async function anthropicDiscoverVariantClick(page: Page, targetSizeLabel: string): Promise<VariantDiscoveryResult> {
    const buffer = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
    const base64 = buffer.toString('base64');

    const response = await withRetry('variant-discovery', () => getClient().messages.create({
        model: VISION_MODEL,
        max_tokens: 400,
        system: VARIANT_DISCOVERY_PROMPT,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
                    { type: 'text', text: `Target size: ${targetSizeLabel}\n\nIdentify the click target for this variant.` },
                ],
            },
        ],
    }));

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') throw new Error('Variant discovery returned no text');
    const text = textBlock.text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Variant discovery returned non-JSON: ${text.slice(0, 200)}`);

    const parsed = JSON.parse(jsonMatch[0]) as Partial<VariantDiscoveryResult>;
    return {
        already_displayed: parsed.already_displayed ?? false,
        click_text: parsed.click_text ?? null,
        displayed_price: typeof parsed.displayed_price === 'number' ? parsed.displayed_price : null,
        reasoning: parsed.reasoning ?? '',
    };
}

async function findSelectorForPrice(
    page: Page,
    priceText: string,
): Promise<{ selectorType: SelectorType; selector: string } | null> {
    const normalized = priceText.replace(/[€£$\s]/g, '').trim();
    if (!normalized) return null;

    const selector = await page.evaluate((search: string) => {
        function getSelector(el: Element): string {
            if (el.id) return `#${CSS.escape(el.id)}`;
            for (const attr of ['itemprop', 'data-price', 'data-product-price', 'data-automation']) {
                if (el.hasAttribute(attr)) {
                    return `${el.tagName.toLowerCase()}[${attr}="${el.getAttribute(attr)}"]`;
                }
            }
            const parts: string[] = [];
            let cur: Element | null = el;
            while (cur && cur !== document.body && cur !== document.documentElement) {
                const c: Element = cur;
                let seg = c.tagName.toLowerCase();
                if (c.id) {
                    parts.unshift(`#${CSS.escape(c.id)}`);
                    break;
                }
                const classes = Array.from(c.classList)
                    .filter((cl: string) => cl.length > 2 && !/^[a-z]{1,2}[A-Z0-9]|^_|^css-|^sc-|^svelte-/.test(cl))
                    .slice(0, 2);
                if (classes.length > 0) {
                    seg += '.' + classes.map((cl: string) => CSS.escape(cl)).join('.');
                } else {
                    const parent = c.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children).filter((s: Element) => s.tagName === c.tagName);
                        if (siblings.length > 1) {
                            seg += `:nth-of-type(${siblings.indexOf(c) + 1})`;
                        }
                    }
                }
                parts.unshift(seg);
                cur = c.parentElement;
            }
            return parts.join(' > ');
        }

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let best: Element | null = null;
        let bestDepth = -1;

        let node: Node | null = walker.currentNode;
        while (node) {
            const el = node as Element;
            const text = (el.textContent ?? '').replace(/\s/g, '');
            if (text.includes(search)) {
                let depth = 0;
                let p: Element | null = el;
                while (p) { depth++; p = p.parentElement; }
                if (depth > bestDepth) {
                    bestDepth = depth;
                    best = el;
                }
            }
            node = walker.nextNode();
        }

        if (!best) return null;
        return getSelector(best);
    }, normalized);

    if (!selector) return null;

    try {
        const liveText = await page.locator(selector).first().innerText({ timeout: SELECTOR_TIMEOUT_MS });
        if (cleanPrice(liveText) > 0) {
            return { selectorType: SelectorType.Css, selector };
        }
    } catch {
        // ignore
    }

    return null;
}
