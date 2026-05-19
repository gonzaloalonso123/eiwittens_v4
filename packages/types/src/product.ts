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
 */
export type ExtractionMethod =
    | 'playwright'
    | 'free_jsonld'
    | 'free_shopify'
    | 'free_og'
    | 'free_microdata'
    | 'feed_awin';

export interface Product {
    id: string;
    name: string;
    store: string;
    url: string;
    image?: string;
    type: ProductType;
    subtypes: string[];

    // Toggles
    enabled: boolean;
    scrape_enabled: boolean;
    out_of_stock: boolean;
    enabled_top10: boolean;
    only_in_store: boolean;
    warning?: boolean;

    // Extraction strategy — defaults to 'playwright' when unset
    extraction_method?: ExtractionMethod;

    /**
     * When true, the AI fallback will NOT overwrite this product's `scraper`
     * actions even if it finds a high-confidence replacement selector.
     * Use to lock in manual configurations against auto-fix.
     */
    manual_lock?: boolean;

    // Scraper config
    scraper: ScraperAction[];
    cookieBannerXPaths?: string[];
    scrapeTarget?: ScrapeTarget;

    // Pricing
    price: number;
    provisional_price?: number | null;

    // Specs
    amount: number;
    dose?: number; // serving size in grams (preworkout)

    // Nutritional data (per 100g)
    protein_per_100g?: number;
    creatine_per_100g?: number;
    sugar_per_100g?: number;
    calories_per_100g?: number;
    caffeine_per_100g?: number;
    beta_alanine_per_100g?: number;
    citrulline_per_100g?: number;
    tyrosine_per_100g?: number;

    // Ingredients breakdown (preworkout)
    ingredients: Ingredient[];

    // Discount
    discount_type?: DiscountType;
    discount_value?: number;
    discount_code?: string;

    // Reviews
    trustpilot_url?: string;
    trustpilot_score?: number;

    // Computed fields — written by scrape pipeline
    price_for_element_gram?: number;
    price_per_dose?: number;
    price_per_100_calories?: number;
    price_per_1000_calories?: number;

    // Analytics
    count_clicked?: Array<{ date: { seconds: number; nanoseconds: number } }>;
    price_history?: Array<{ date: string; scrapedData: number }>;
}

export type ProductUpdate = Partial<Omit<Product, 'id'>>;

export type ProductCreate = Omit<Product, 'id' | 'price_for_element_gram' | 'price_per_dose' | 'price_per_100_calories' | 'price_per_1000_calories' | 'count_clicked' | 'provisional_price' | 'warning'>;
