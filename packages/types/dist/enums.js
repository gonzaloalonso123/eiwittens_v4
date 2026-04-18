// ── Product types ────────────────────────────────────────────────────────────
export var ProductType;
(function (ProductType) {
    ProductType["Proteine"] = "proteine";
    ProductType["Creatine"] = "creatine";
    ProductType["WeightGainer"] = "weight_gainer";
    ProductType["Preworkout"] = "preworkout";
    ProductType["PreworkoutIngredient"] = "preworkout_ingredient";
    ProductType["Vitamins"] = "vitamins";
    ProductType["Other"] = "other";
    ProductType["Food"] = "food";
})(ProductType || (ProductType = {}));
// ── Discount types ──────────────────────────────────────────────────────────
export var DiscountType;
(function (DiscountType) {
    DiscountType["None"] = "none";
    DiscountType["Percentage"] = "percentage";
    DiscountType["Fixed"] = "fixed";
})(DiscountType || (DiscountType = {}));
// ── Scraper action types ────────────────────────────────────────────────────
export var ActionType;
(function (ActionType) {
    ActionType["Click"] = "click";
    ActionType["Select"] = "select";
    ActionType["SelectOption"] = "selectOption";
    ActionType["Wait"] = "wait";
})(ActionType || (ActionType = {}));
export var SelectorType;
(function (SelectorType) {
    SelectorType["Css"] = "css";
    SelectorType["Xpath"] = "xpath";
})(SelectorType || (SelectorType = {}));
//# sourceMappingURL=enums.js.map