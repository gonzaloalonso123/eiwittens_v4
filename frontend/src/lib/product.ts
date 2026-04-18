import type { ProductCreate } from '@eiwittens/types';
import { ProductType, DiscountType } from '@eiwittens/types';

export const emptyProduct: Omit<ProductCreate, 'scraper' | 'cookieBannerXPaths'> & { scraper: []; cookieBannerXPaths: [] } = {
    name: '',
    store: '',
    url: '',
    type: ProductType.Proteine,
    subtypes: [],
    enabled: true,
    scrape_enabled: true,
    out_of_stock: false,
    enabled_top10: true,
    only_in_store: false,
    scraper: [],
    cookieBannerXPaths: [],
    price: 0,
    amount: 0,
    ingredients: [],
    discount_type: DiscountType.None,
    discount_value: 0,
    discount_code: '',
};

export const nutritionFieldsByType: Partial<Record<ProductType, string[]>> = {
    [ProductType.Proteine]: ['protein_per_100g', 'sugar_per_100g', 'calories_per_100g'],
    [ProductType.Creatine]: ['creatine_per_100g'],
    [ProductType.WeightGainer]: ['protein_per_100g', 'sugar_per_100g', 'calories_per_100g'],
    [ProductType.Preworkout]: ['caffeine_per_100g', 'beta_alanine_per_100g', 'citrulline_per_100g', 'tyrosine_per_100g', 'calories_per_100g'],
    [ProductType.PreworkoutIngredient]: ['caffeine_per_100g', 'beta_alanine_per_100g', 'citrulline_per_100g', 'tyrosine_per_100g'],
    [ProductType.Vitamins]: [],
    [ProductType.Food]: ['protein_per_100g', 'sugar_per_100g', 'calories_per_100g'],
    [ProductType.Other]: [],
};

export const nutritionLabels: Record<string, string> = {
    protein_per_100g: 'Protein per 100g',
    creatine_per_100g: 'Creatine per 100g',
    sugar_per_100g: 'Sugar per 100g',
    calories_per_100g: 'Calories per 100g',
    caffeine_per_100g: 'Caffeine per 100g (mg)',
    beta_alanine_per_100g: 'Beta-Alanine per 100g',
    citrulline_per_100g: 'Citrulline per 100g',
    tyrosine_per_100g: 'Tyrosine per 100g',
};

export const typeLabels = Object.fromEntries(
    [
        { value: ProductType.Proteine, label: 'Protein' },
        { value: ProductType.Creatine, label: 'Creatine' },
        { value: ProductType.WeightGainer, label: 'Weight Gainer' },
        { value: ProductType.Preworkout, label: 'Pre-workout' },
        { value: ProductType.PreworkoutIngredient, label: 'Pre-workout Ingredients' },
        { value: ProductType.Vitamins, label: 'Vitamins' },
        { value: ProductType.Other, label: 'Other' },
        { value: ProductType.Food, label: 'Food Supplements' },
    ].map((t) => [t.value, t.label]),
);

export const toggleFields: [string, string][] = [
    ['enabled', 'Enabled'],
    ['scrape_enabled', 'Scrape Enabled'],
    ['enabled_top10', 'Show in Top 10'],
    ['out_of_stock', 'Out of Stock'],
    ['only_in_store', 'Only in Store'],
];

export const computedFields = (form: Record<string, unknown>): [string, string][] => [
    ['Price', `€${(form.price as number)?.toFixed(2) ?? '—'}`],
    ['€ per 100g element', form.price_for_element_gram ? `€${(form.price_for_element_gram as number).toFixed(2)}` : '—'],
    ['€ per dose', form.price_per_dose ? `€${(form.price_per_dose as number).toFixed(2)}` : '—'],
    ['€ per 100 calories', form.price_per_100_calories ? `€${(form.price_per_100_calories as number).toFixed(2)}` : '—'],
    ['€ per 1000 calories', form.price_per_1000_calories ? `€${(form.price_per_1000_calories as number).toFixed(2)}` : '—'],
    ['Trustpilot Score', form.trustpilot_score ? String(form.trustpilot_score) : '—'],
    ['Clicks', `${((form.count_clicked ?? []) as unknown[]).length}`],
    ['Warning', form.warning ? 'Yes' : 'No'],
    ['Provisional Price', form.provisional_price != null ? `€${form.provisional_price}` : 'None'],
];
