import type { Page, Locator } from 'playwright';
import type { Request, Response, NextFunction } from 'express';
/**
 * Parses a raw price string or number into a float.
 * Handles both European (1.234,56) and US (1,234.56) formats.
 */
export declare function cleanPrice(raw: string | number): number;
/**
 * Returns a Playwright Locator for either a CSS or XPath selector.
 */
export declare function locate(page: Page, selectorType: string, value: string): Locator;
/**
 * Express error handler for async route bodies.
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export declare function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=utils.d.ts.map