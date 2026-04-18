import type { Product } from '@eiwittens/types';
import { DiscountType } from '@eiwittens/types';

export function applyDiscount(product: Product): Product {
    if (!product.discount_value || product.discount_type === DiscountType.None) return product;

    let newPrice: number;
    if (product.discount_type === DiscountType.Percentage) {
        newPrice = product.price - product.price * (product.discount_value / 100);
    } else {
        newPrice = product.price - product.discount_value;
    }

    return { ...product, price: parseFloat(newPrice.toFixed(2)) };
}

export function applyDiscounts(products: Product[]): Product[] {
    return products.map(applyDiscount);
}
