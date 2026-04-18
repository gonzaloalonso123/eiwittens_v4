import type { Product, ScraperAction } from '@eiwittens/types';
export interface ScrapeResult {
    price: number;
    aiUsed: boolean;
}
export interface TestScrapeStepEvent {
    step: string;
    message: string;
    index?: number;
    action?: ScraperAction;
    screenshot?: string | null;
}
export interface TestScrapeResultEvent {
    success: boolean;
    price: number;
    screenshot: string | null;
    aiFixed: boolean;
    fixedActions?: ScraperAction[];
    message?: string;
    error?: string;
}
export type TestScrapeEvent = {
    type: 'step';
    data: TestScrapeStepEvent;
} | {
    type: 'result';
    data: TestScrapeResultEvent;
};
type OnEvent = (event: TestScrapeEvent) => void;
export declare function testScrapeWithProgress(url: string, actions: ScraperAction[], cookieBannerXPaths: string[], onEvent: OnEvent): Promise<void>;
export declare function scrapeProduct(product: Product): Promise<ScrapeResult>;
export {};
//# sourceMappingURL=index.d.ts.map