import OpenAI from 'openai';
import { JSDOM } from 'jsdom';
import { config } from '../config.js';
import { ActionType, SelectorType } from '@eiwittens/types';
import { cleanPrice, locate } from '../lib/utils.js';
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
const MAX_HTML_CHARS = 40_000;
const SELECTOR_TIMEOUT_MS = 5_000;
export async function aiExtractPrice(page, url) {
    const rawHtml = await page.evaluate(() => document.documentElement.outerHTML);
    const cleanedHtml = truncateHtml(stripNonContentElements(rawHtml), MAX_HTML_CHARS);
    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            {
                role: 'system',
                content: `You are an expert web scraper. Your task is to locate the main product price on a page and return selectors that will remain stable over time.

Selector quality rules (in order of preference):
1. Schema.org / microdata attributes: [itemprop="price"], [property="product:price:amount"]
2. Semantic data attributes: [data-price], [data-product-price], [data-automation="price"]
3. Stable IDs: #product-price, #price
4. Stable non-positional class selectors (e.g. .price__current, .product-price)
5. AVOID: positional XPath (//div[3]/span[2]), generated class names (e.g. _3xQ9z), nth-child chains

Return ONLY valid JSON — no markdown, no extra text.`,
            },
            {
                role: 'user',
                content: `Find the main product price in this HTML. Return JSON:
{
  "price": "<price text as shown on page>",
  "candidates": [
    { "selectorType": "css"|"xpath", "selector": "<most stable selector>" },
    { "selectorType": "css"|"xpath", "selector": "<second choice>" },
    { "selectorType": "css"|"xpath", "selector": "<third choice>" }
  ]
}

URL: ${url}

HTML:
${cleanedHtml}`,
            },
        ],
        response_format: { type: 'json_object' },
    });
    const content = response.choices[0]?.message.content;
    if (!content)
        throw new Error('OpenAI returned empty response');
    const parsed = JSON.parse(content);
    console.log('AI extraction result:', content);
    // Try each candidate selector in order; use the first one that resolves live text
    for (const candidate of parsed.candidates ?? []) {
        try {
            const liveText = await locate(page, candidate.selectorType, candidate.selector)
                .first()
                .innerText({ timeout: SELECTOR_TIMEOUT_MS });
            const price = cleanPrice(liveText);
            if (price > 0) {
                return {
                    price,
                    fixedScraper: [
                        {
                            id: crypto.randomUUID(),
                            type: ActionType.Select,
                            selectorType: candidate.selectorType,
                            selectorValue: candidate.selector,
                        },
                    ],
                };
            }
        }
        catch {
            // This candidate didn't work — try the next one
        }
    }
    // All AI candidates failed to resolve live — brute-force: find an element on the page
    // that contains the price text the AI extracted from HTML
    const aiPrice = cleanPrice(parsed.price ?? '');
    if (aiPrice > 0) {
        const provenSelector = await findSelectorForPrice(page, parsed.price);
        if (provenSelector) {
            return {
                price: aiPrice,
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
        // Last resort: return the price but with no fixedScraper
        return { price: aiPrice, fixedScraper: [] };
    }
    throw new Error('AI could not extract a valid price from the page');
}
/**
 * Searches the live page for an element whose visible text contains the given price string.
 * Returns the most specific (deepest) element as a CSS selector proven to work on the page.
 */
async function findSelectorForPrice(page, priceText) {
    // Normalize: extract just the digits/separators from the AI-returned price text
    const normalized = priceText.replace(/[€£$\s]/g, '').trim();
    if (!normalized)
        return null;
    // Find all elements containing the price text, pick the most specific (smallest) one
    const selector = await page.evaluate((search) => {
        function getSelector(el) {
            // Prefer id
            if (el.id)
                return `#${CSS.escape(el.id)}`;
            // Prefer data attributes
            for (const attr of ['itemprop', 'data-price', 'data-product-price', 'data-automation']) {
                if (el.hasAttribute(attr)) {
                    return `${el.tagName.toLowerCase()}[${attr}="${el.getAttribute(attr)}"]`;
                }
            }
            // Build a path from the nearest ancestor with an id
            const parts = [];
            let cur = el;
            while (cur && cur !== document.body && cur !== document.documentElement) {
                const c = cur;
                let seg = c.tagName.toLowerCase();
                if (c.id) {
                    parts.unshift(`#${CSS.escape(c.id)}`);
                    break;
                }
                // Use stable class names
                const classes = Array.from(c.classList)
                    .filter((cl) => cl.length > 2 && !/^[a-z]{1,2}[A-Z0-9]|^_|^css-|^sc-|^svelte-/.test(cl))
                    .slice(0, 2);
                if (classes.length > 0) {
                    seg += '.' + classes.map((cl) => CSS.escape(cl)).join('.');
                }
                else {
                    const parent = c.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children).filter((s) => s.tagName === c.tagName);
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
        // Walk the DOM tree, find the deepest (most specific) element that contains the price
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let best = null;
        let bestDepth = -1;
        let node = walker.currentNode;
        while (node) {
            const el = node;
            const text = (el.textContent ?? '').replace(/\s/g, '');
            if (text.includes(search)) {
                // Measure depth
                let depth = 0;
                let p = el;
                while (p) {
                    depth++;
                    p = p.parentElement;
                }
                if (depth > bestDepth) {
                    bestDepth = depth;
                    best = el;
                }
            }
            node = walker.nextNode();
        }
        if (!best)
            return null;
        return getSelector(best);
    }, normalized);
    if (!selector)
        return null;
    // Verify the selector works live
    try {
        const liveText = await page.locator(selector).first().innerText({ timeout: SELECTOR_TIMEOUT_MS });
        if (cleanPrice(liveText) > 0) {
            return { selectorType: SelectorType.Css, selector };
        }
    }
    catch {
        // selector didn't resolve
    }
    return null;
}
function stripNonContentElements(html) {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    doc
        .querySelectorAll('script, style, iframe, img, svg, link, meta, noscript, footer, nav, header')
        .forEach((el) => el.remove());
    return doc.body.innerHTML;
}
function truncateHtml(html, maxChars) {
    if (html.length <= maxChars)
        return html;
    // Truncate but try not to cut mid-tag
    const cutoff = html.lastIndexOf('>', maxChars);
    return cutoff > maxChars * 0.8 ? html.slice(0, cutoff + 1) : html.slice(0, maxChars);
}
//# sourceMappingURL=extractor.js.map