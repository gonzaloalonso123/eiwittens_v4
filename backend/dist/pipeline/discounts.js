import { DiscountType } from '@eiwittens/types';
export function applyDiscount(product) {
    if (!product.discount_value || product.discount_type === DiscountType.None)
        return product;
    let newPrice;
    if (product.discount_type === DiscountType.Percentage) {
        newPrice = product.price - product.price * (product.discount_value / 100);
    }
    else {
        newPrice = product.price - product.discount_value;
    }
    return { ...product, price: parseFloat(newPrice.toFixed(2)) };
}
export function applyDiscounts(products) {
    return products.map(applyDiscount);
}
//# sourceMappingURL=discounts.js.map