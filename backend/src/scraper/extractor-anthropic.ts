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
const MAX_HTML_CHARS = 40_000;
const MAX_TOKENS = 800;
const SELECTOR_TIMEOUT_MS = 5_000;

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

    const response = await getClient().messages.create({
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
    });

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
