// ── Product types ────────────────────────────────────────────────────────────

export enum ProductType {
    Proteine = 'proteine',
    Creatine = 'creatine',
    WeightGainer = 'weight_gainer',
    Preworkout = 'preworkout',
    PreworkoutIngredient = 'preworkout_ingredient',
    Vitamins = 'vitamins',
    Other = 'other',
    Food = 'food',
}

// ── Discount types ──────────────────────────────────────────────────────────

export enum DiscountType {
    None = 'none',
    Percentage = 'percentage',
    Fixed = 'fixed',
}

// ── Scraper action types ────────────────────────────────────────────────────

export enum ActionType {
    Click = 'click',
    Select = 'select',
    SelectOption = 'selectOption',
    Wait = 'wait',
}

export enum SelectorType {
    Css = 'css',
    Xpath = 'xpath',
}
