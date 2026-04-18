const PRICE_DROP_THRESHOLD_PERCENT = 30;
function pricePerElementGram(product, elementPer100g) {
    if (!product.amount || !product.price)
        return null;
    const elementGrams = product.amount * (elementPer100g / 100);
    if (elementGrams === 0)
        return null;
    return product.price / elementGrams;
}
function getComparablePrice(product) {
    if (product.type === 'proteine' || product.type === 'weight_gainer') {
        return product.protein_per_100g
            ? pricePerElementGram(product, product.protein_per_100g)
            : null;
    }
    if (product.type === 'creatine') {
        return product.creatine_per_100g
            ? pricePerElementGram(product, product.creatine_per_100g)
            : null;
    }
    // preworkout / preworkout_ingredient — no element gram comparison
    return null;
}
export function applySecurityCheck(newProducts, oldProducts) {
    return newProducts.map((newProduct) => {
        const oldProduct = oldProducts.find((p) => p.id === newProduct.id);
        if (!oldProduct)
            return newProduct;
        const newPpg = getComparablePrice(newProduct);
        const oldPpg = getComparablePrice(oldProduct);
        if (newPpg === null || oldPpg === null)
            return newProduct;
        const isSuspiciouslyLow = newPpg < oldPpg * (1 - PRICE_DROP_THRESHOLD_PERCENT / 100);
        if (isSuspiciouslyLow) {
            console.warn(`[security] Suspicious price drop for "${newProduct.name}": ` +
                `€${oldProduct.price} → €${newProduct.price}. Holding old price as provisional.`);
        }
        return {
            ...newProduct,
            price: isSuspiciouslyLow ? oldProduct.price : newProduct.price,
            provisional_price: isSuspiciouslyLow ? newProduct.price : null,
        };
    });
}
//# sourceMappingURL=security.js.map