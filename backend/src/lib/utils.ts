import type { Page, Locator } from 'playwright';
import type { Request, Response, NextFunction } from 'express';
import { Product } from '../../../packages/types/src/product.js';

/**
 * Parses a raw price string or number into a float.
 * Handles both European (1.234,56) and US (1,234.56) formats.
 */
export function cleanPrice(raw: string | number): number {
    const str = String(raw).trim();
    // Detect European format: digits, then a dot for thousands, then a comma for decimals
    const isEuropean = /\d{1,3}(\.\d{3})+(,\d+)?$/.test(str);
    const cleaned = str
        .replace(/[€£$]/g, '')
        .replace(/\s/g, '')
        .replace(isEuropean ? /\./g : /(?<=\d),(?=\d{3})/g, '') // strip thousands separator
        .replace(',', '.')                                         // normalize decimal comma
        .replace(/[^0-9.]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
}

/**
 * Returns a Playwright Locator for either a CSS or XPath selector.
 */
export function locate(page: Page, selectorType: string, value: string): Locator {
    if (selectorType === 'css') return page.locator(value);
    return page.locator(`xpath=${value}`);
}

/**
 * Express error handler for async route bodies.
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
    return (req: Request, res: Response, next: NextFunction): void => {
        fn(req, res, next).catch((err: unknown) => {
            res.status(500).json({ error: (err as Error).message });
        });
    };
}


export function minimizeProducts(products: Product[]): Partial<Product>[] {
    return products.map(p => {
        const { scraper, count_clicked, cookieBannerXPaths, ...rest } = p;
        return rest;
    })
}