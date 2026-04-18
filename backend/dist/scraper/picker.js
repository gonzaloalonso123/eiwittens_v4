import { createDriver } from './driver.js';
import { dismissCookieBanner } from './actions.js';
export async function pickElementAtPoint(url, x, y, cookieBannerXPaths) {
    const { page, cleanup } = await createDriver();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await dismissCookieBanner(page, cookieBannerXPaths);
        return await page.evaluate(({ px, py }) => {
            const el = document.elementFromPoint(px, py);
            if (!el)
                return null;
            const text = (el.textContent ?? '').trim().slice(0, 200);
            function getCssSelector(node) {
                if (node.id)
                    return `#${CSS.escape(node.id)}`;
                const parts = [];
                let cur = node;
                while (cur && cur !== document.body && cur !== document.documentElement) {
                    const c = cur;
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
                        .filter((cl) => cl.length > 2 && !/^[a-z]{1,2}[A-Z0-9]|^_|^css-|^sc-/.test(cl))
                        .slice(0, 2);
                    if (classes.length > 0) {
                        selector += '.' + classes.map((cl) => CSS.escape(cl)).join('.');
                    }
                    else {
                        const parent = c.parentElement;
                        if (parent) {
                            const siblings = Array.from(parent.children).filter((s) => s.tagName === c.tagName);
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
            function getXPath(node) {
                if (node.id)
                    return `//*[@id="${node.id}"]`;
                const parts = [];
                let cur = node;
                while (cur && cur !== document.body && cur !== document.documentElement) {
                    const c = cur;
                    let part = c.tagName.toLowerCase();
                    if (c.id) {
                        parts.unshift(`*[@id="${c.id}"]`);
                        break;
                    }
                    const parent = c.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children).filter((s) => s.tagName === c.tagName);
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
    }
    finally {
        await cleanup();
    }
}
export async function takePageScreenshot(url, cookieBannerXPaths) {
    const { page, cleanup } = await createDriver();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await dismissCookieBanner(page, cookieBannerXPaths);
        const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
        return buf.toString('base64');
    }
    finally {
        await cleanup();
    }
}
//# sourceMappingURL=picker.js.map