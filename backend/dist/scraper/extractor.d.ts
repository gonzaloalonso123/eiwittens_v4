import type { Page } from 'playwright';
import type { ScraperAction } from '@eiwittens/types';
export interface AiExtractResult {
    price: number;
    /** A working SelectAction the caller can persist back to Firestore to fix the scraper. */
    fixedScraper: ScraperAction[];
}
export declare function aiExtractPrice(page: Page, url: string): Promise<AiExtractResult>;
//# sourceMappingURL=extractor.d.ts.map