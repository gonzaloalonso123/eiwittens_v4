import { JSDOM } from 'jsdom';
import type { Page } from 'playwright';

/**
 * Takes a JPEG screenshot of the current page, returns base64 or null on failure.
 */
export async function takeScreenshot(page: Page): Promise<string | null> {
    try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
        return buf.toString('base64');
    } catch {
        return null;
    }
}

/**
 * Strips non-content elements (scripts, styles, images, etc.) from raw HTML.
 */
export function stripHtml(html: string): string {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    doc
        .querySelectorAll('script, style, iframe, img, svg, link, meta, noscript, footer, nav, header')
        .forEach((el: Element) => el.remove());
    return doc.body.innerHTML;
}

/**
 * Truncates HTML to maxChars, trying not to cut mid-tag.
 */
export function truncateHtml(html: string, maxChars: number): string {
    if (html.length <= maxChars) return html;
    const cutoff = html.lastIndexOf('>', maxChars);
    return cutoff > maxChars * 0.8 ? html.slice(0, cutoff + 1) : html.slice(0, maxChars);
}

/**
 * Regex for filtering out generated/hashed CSS class names.
 * Use inside page.evaluate() by passing as a string pattern.
 */
export const GENERATED_CLASS_PATTERN = /^[a-z]{1,2}[A-Z0-9]|^_|^css-|^sc-|^svelte-/;

/**
 * Generates a CSS selector for a DOM element.
 * NOTE: This runs in Node context. For browser context (page.evaluate),
 * the logic must be inlined since functions can't be serialized.
 */
export function generateCssSelector(el: Element): string {
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
            .filter((cl: string) => cl.length > 2 && !GENERATED_CLASS_PATTERN.test(cl))
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

/**
 * Generates an XPath selector for a DOM element.
 * NOTE: This runs in Node context. For browser context, inline the logic.
 */
export function generateXPath(el: Element): string {
    if (el.id) return `//*[@id="${el.id}"]`;

    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
        const c: Element = cur;
        let part = c.tagName.toLowerCase();
        if (c.id) {
            parts.unshift(`*[@id="${c.id}"]`);
            break;
        }
        const parent = c.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter((s: Element) => s.tagName === c.tagName);
            if (siblings.length > 1) {
                part += `[${siblings.indexOf(c) + 1}]`;
            }
        }
        parts.unshift(part);
        cur = c.parentElement;
    }
    return '//' + parts.join('/');
}
