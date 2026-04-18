import type { Product } from '@eiwittens/types';
export interface Warning {
    productId: string;
    name: string;
    url: string;
    price: number;
    severity: number;
}
export declare function applyWarnings(products: Product[]): Product[];
export declare function collectWarnings(products: Product[]): Warning[];
//# sourceMappingURL=warnings.d.ts.map