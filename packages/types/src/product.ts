import type { ProductType, DiscountType } from './enums.js';
import type { ScraperAction } from './scraper.js';

export interface Ingredient {
    name: string;
    amount: number;
}

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

    // Scraper config
    scraper: ScraperAction[];
    cookieBannerXPaths?: string[];

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
