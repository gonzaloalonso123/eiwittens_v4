import type { ProductType, DiscountType } from './enums.js';
import type { ScraperAction, ScrapeTarget } from './scraper.js';
export interface Ingredient {
    name: string;
    amount: number;
}
/**
 * Strategy used to extract the current price for this product.
 * - 'playwright' (default) — current XPath/Click/Select actions via Playwright; AI fallback
 * - 'free_jsonld' — direct HTTP fetch + Schema.org JSON-LD Product offers
 * - 'free_shopify' — Shopify /products/<handle>.json endpoint
 * - 'free_og' — OpenGraph product:price:amount meta
 * - 'free_microdata' — Inline itemprop="price"
 * - 'feed_awin' — Daily Awin product datafeed (no scrape on this product)
 * - 'vision_only' — Price is only readable via Claude vision (screenshot) — daily scrape skips,
 *                   monthly verify-with-ai is the sole price refresher.
 */
export type ExtractionMethod = 'playwright' | 'free_jsonld' | 'free_shopify' | 'free_og' | 'free_microdata' | 'feed_awin' | 'vision_only';
export interface Product {
    id: string;
    name: string;
    store: string;
    url: string;
    image?: string;
    type: ProductType;
    subtypes: string[];
    enabled: boolean;
    scrape_enabled: boolean;
    out_of_stock: boolean;
    enabled_top10: boolean;
    only_in_store: boolean;
    warning?: boolean;
    extraction_method?: ExtractionMethod;
    /**
     * When true, the AI fallback will NOT overwrite this product's `scraper`
     * actions even if it finds a high-confidence replacement selector.
     * Use to lock in manual configurations against auto-fix.
     */
    manual_lock?: boolean;
    scraper: ScraperAction[];
    cookieBannerXPaths?: string[];
    scrapeTarget?: ScrapeTarget;
    /**
     * Last time the monthly AI verification confirmed (or repaired) this
     * product's price selector. Written by `jobs/verify-with-ai.ts`.
     *
     * Stored as a Firestore Timestamp on the server; surfaced as Date or
     * { seconds, nanoseconds } on the client depending on serialization path.
     */
    ai_verified_at?: Date | {
        seconds: number;
        nanoseconds: number;
    };
    /** Price that AI extracted at the last verification — used for drift detection. */
    ai_verified_price?: number;
    /**
     * Cumulative count of verifications where AI disagreed with the
     * existing XPath. High values signal an unstable shop layout.
     */
    ai_disagreement_count?: number;
    /**
     * Number of consecutive daily scrapes that fell back to AI extraction
     * (the XPath failed). Reset to 0 on the next successful XPath extract.
     * Once this reaches the configured promotion threshold the product is
     * auto-promoted to `extraction_method: 'vision_only'` so the daily scrape
     * stops burning AI calls and the monthly verify-with-ai job takes over.
     */
    consecutive_ai_fallbacks?: number;
    price: number;
    provisional_price?: number | null;
    amount: number;
    dose?: number;
    protein_per_100g?: number;
    creatine_per_100g?: number;
    sugar_per_100g?: number;
    calories_per_100g?: number;
    caffeine_per_100g?: number;
    beta_alanine_per_100g?: number;
    citrulline_per_100g?: number;
    tyrosine_per_100g?: number;
    ingredients: Ingredient[];
    discount_type?: DiscountType;
    discount_value?: number;
    discount_code?: string;
    trustpilot_url?: string;
    trustpilot_score?: number;
    price_for_element_gram?: number;
    price_per_dose?: number;
    price_per_100_calories?: number;
    price_per_1000_calories?: number;
    count_clicked?: Array<{
        date: {
            seconds: number;
            nanoseconds: number;
        };
    }>;
    price_history?: Array<{
        date: string;
        scrapedData: number;
    }>;
}
export type ProductUpdate = Partial<Omit<Product, 'id'>>;
export type ProductCreate = Omit<Product, 'id' | 'price_for_element_gram' | 'price_per_dose' | 'price_per_100_calories' | 'price_per_1000_calories' | 'count_clicked' | 'provisional_price' | 'warning'>;
//# sourceMappingURL=product.d.ts.map