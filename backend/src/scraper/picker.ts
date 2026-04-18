import { createDriver } from './driver.js';
import { dismissCookieBanner } from './actions.js';
import { takeScreenshot } from './helpers.js';

export interface PickElementResult {
    text: string;
    tagName: string;
    css: string;
    xpath: string;
}

export async function pickElementAtPoint(
    url: string,
    x: number,
    y: number,
    cookieBannerXPaths: string[],
): Promise<PickElementResult | null> {
    const { page, cleanup } = await createDriver();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await dismissCookieBanner(page, cookieBannerXPaths);

        return await page.evaluate(({ px, py }: { px: number; py: number }) => {
            const el = document.elementFromPoint(px, py);
            if (!el) return null;

            const text = (el.textContent ?? '').trim().slice(0, 200);

            function getCssSelector(node: Element): string {
                if (node.id) return `#${CSS.escape(node.id)}`;
                const parts: string[] = [];
                let cur: Element | null = node;
                while (cur && cur !== document.body && cur !== document.documentElement) {
                    const c: Element = cur;
                    let selector = c.tagName.toLowerCase();
                    if (c.id) {
                        parts.unshift(`#${CSS.escape(c.id)}`);
                        break;
                    }
                    for (const attr of ['data-price', 'data-product-price', 'itemprop', 'data-automation']) {
                        if (c.hasAttribute(attr)) {
                            parts.unshift(`${selector}[${attr}="${c.getAttribute(attr)}"]`);
                            cur = c.parentElement;
                            continue;
                        }
                    }
                    const classes = Array.from(c.classList)
                        .filter((cl: string) => cl.length > 2 && !/^[a-z]{1,2}[A-Z0-9]|^_|^css-|^sc-/.test(cl))
                        .slice(0, 2);
                    if (classes.length > 0) {
                        selector += '.' + classes.map((cl: string) => CSS.escape(cl)).join('.');
                    } else {
                        const parent = c.parentElement;
                        if (parent) {
                            const siblings = Array.from(parent.children).filter((s: Element) => s.tagName === c.tagName);
                            if (siblings.length > 1) {
                                const idx = siblings.indexOf(c) + 1;
                                selector += `:nth-of-type(${idx})`;
                            }
                        }
                    }
                    parts.unshift(selector);
                    cur = c.parentElement;
                }
                return parts.join(' > ');
            }

            function getXPath(node: Element): string {
                if (node.id) return `//*[@id="${node.id}"]`;
                const parts: string[] = [];
                let cur: Element | null = node;
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
                            const idx = siblings.indexOf(c) + 1;
                            part += `[${idx}]`;
                        }
                    }
                    parts.unshift(part);
                    cur = c.parentElement;
                }
                return '//' + parts.join('/');
            }

            return {
                text,
                tagName: el.tagName.toLowerCase(),
                css: getCssSelector(el),
                xpath: getXPath(el),
            };
        }, { px: Math.round(x), py: Math.round(y) });
    } finally {
        await cleanup();
    }
}

export async function takePageScreenshot(
    url: string,
    cookieBannerXPaths: string[],
): Promise<string> {
    const { page, cleanup } = await createDriver();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await dismissCookieBanner(page, cookieBannerXPaths);
        return await takeScreenshot(page) ?? '';
    } finally {
        await cleanup();
    }
}
