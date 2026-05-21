import { ProductType, DiscountType, ActionType } from './enums.js';
// ── Product types ────────────────────────────────────────────────────────────
export const productTypes = [
    { value: ProductType.Proteine, label: 'Protein' },
    { value: ProductType.Creatine, label: 'Creatine' },
    { value: ProductType.WeightGainer, label: 'Weight Gainer' },
    { value: ProductType.Preworkout, label: 'Pre-workout' },
    { value: ProductType.PreworkoutIngredient, label: 'Pre-workout Ingredients' },
    { value: ProductType.Vitamins, label: 'Vitamins' },
    { value: ProductType.Other, label: 'Other' },
    { value: ProductType.Food, label: 'Food Supplements' },
];
// ── Product subtypes (per product type) ──────────────────────────────────────
export const productSubtypes = {
    [ProductType.Proteine]: [
        { value: 'whey_proteine', label: 'Whey Proteïne' },
        { value: 'whey_isolate', label: 'Whey Isolate' },
        { value: 'vegan_proteine', label: 'Vegan Proteïne' },
        { value: 'clear_whey', label: 'Clear whey' },
        { value: 'collagen_protein', label: 'Collageen Eiwit' },
        { value: 'egg_protein', label: 'Ei Eiwit' },
        { value: 'beef_protein', label: 'Beef Proteïne' },
        { value: 'caseine', label: 'Caseïne' },
        { value: 'organic_protein', label: 'Biologische eiwitpoeder' },
        { value: 'paleo_protein', label: 'Paleo eiwitpoeder' },
        { value: 'unsweetened_protein', label: 'Eiwitpoeder Zonder Zoetstof' },
        { value: 'proteine_milkshake', label: 'Proteïne Milkshake' },
        { value: 'lactose_free_protein', label: 'Lactosevrij proteïne poeder' },
        { value: 'diet_whey', label: 'Diet Whey' },
        { value: 'protein_coffee', label: 'Protein Coffee' },
        { value: 'whey_hydro', label: 'Whey Hydro' },
        { value: 'whey_concentrate', label: 'Whey Concentraat' },
        { value: 'collageen_eiwit', label: 'Collageen eiwit' },
        { value: 'pepto_pro', label: 'PeptoPro' },
    ],
    [ProductType.Creatine]: [
        { value: 'monohydrate', label: 'Monohydrate' },
        { value: 'hcl', label: 'HCL' },
        { value: 'blend', label: 'Blend' },
        { value: 'creapure', label: 'Creapure' },
        { value: 'kre_alkalyn', label: 'Kre-Alkalyn' },
        { value: 'ethyl_ester', label: 'Ethyl Ester' },
    ],
    [ProductType.WeightGainer]: [
        { value: 'high_calorie', label: 'High Calorie' },
        { value: 'low_sugar', label: 'Low Sugar' },
    ],
    [ProductType.Preworkout]: [
        { value: 'high_caffeine', label: 'High Caffeine' },
        { value: 'stimulant_free', label: 'Stimulant Free' },
        { value: 'caffeine_free', label: 'Caffeine Free' },
    ],
    [ProductType.PreworkoutIngredient]: [
        { value: 'beta_alanine', label: 'Beta-Alanine' },
        { value: 'l_citrulline', label: 'L-Citrulline' },
        { value: 'tyrosine', label: 'Tyrosine' },
        { value: 'taurine', label: 'Taurine' },
        { value: 'caffeine_tablets', label: 'Caffeine Tablets' },
    ],
    [ProductType.Vitamins]: [
        { value: 'multivitamin', label: 'Multivitamin' },
        { value: 'vitamin_d', label: 'Vitamin D' },
        { value: 'vitamin_c', label: 'Vitamin C' },
    ],
    [ProductType.Food]: [
        { value: 'protein_bar', label: 'Protein Bar' },
        { value: 'protein_oats', label: 'Protein Oats' },
    ],
    [ProductType.Other]: [],
};
// ── Discount types ──────────────────────────────────────────────────────────
export const discountTypes = [
    { value: DiscountType.None, label: 'None' },
    { value: DiscountType.Percentage, label: 'Percentage' },
    { value: DiscountType.Fixed, label: 'Fixed Amount' },
];
// ── Scraper action types ────────────────────────────────────────────────────
export const actionTypes = [
    { value: ActionType.Click, label: 'Click' },
    { value: ActionType.ClickByText, label: 'Click by text (variant-aware)' },
    { value: ActionType.Select, label: 'Select' },
    { value: ActionType.SelectOption, label: 'Select Option' },
    { value: ActionType.Wait, label: 'Wait' },
];
//# sourceMappingURL=constants.js.map