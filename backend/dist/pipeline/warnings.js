const DASHBOARD_URL = 'https://eiwittens.web.app/products';
export function applyWarnings(products) {
    return products.map((p) => ({
        ...p,
        warning: p.price === 0 || !p.amount,
    }));
}
export function collectWarnings(products) {
    return products
        .filter((p) => p.warning)
        .map((p) => ({
        productId: p.id,
        name: p.name,
        url: `${DASHBOARD_URL}/${p.id}`,
        price: p.price,
        severity: p.count_clicked?.length ?? 0,
    }));
}
//# sourceMappingURL=warnings.js.map