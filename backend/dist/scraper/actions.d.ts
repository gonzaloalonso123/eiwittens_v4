import type { Page } from 'playwright';
import type { ScraperAction } from '@eiwittens/types';
export declare function dismissCookieBanner(page: Page, extraXPaths?: string[], timeout?: number): Promise<void>;
export type ActionCallback = (index: number, action: ScraperAction, status: 'start' | 'done' | 'failed', error?: string) => Promise<void> | void;
export declare function executeActions(page: Page, actions: ScraperAction[], timeout?: number, onAction?: ActionCallback): Promise<string>;
//# sourceMappingURL=actions.d.ts.map