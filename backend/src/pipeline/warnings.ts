import type { Product } from '@eiwittens/types';

const DASHBOARD_URL = 'https://eiwittens.web.app/products';

export interface Warning {
    productId: string;
    name: string;
    url: string;
    price: number;
    severity: number; // click count — indicates how important this product is
}

export function applyWarnings(products: Product[]): Product[] {
    return products.map((p) => ({
        ...p,
        warning: !Number.isFinite(p.price) || p.price <= 0,
    }));
}

export function collectWarnings(products: Product[]): Warning[] {
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
