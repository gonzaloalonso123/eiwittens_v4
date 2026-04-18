import type { Product, ProductUpdate, ProductCreate } from '@eiwittens/types';
export declare function getProducts(): Promise<Product[]>;
export declare function getEnabledScrapableProducts(): Promise<Product[]>;
export declare function getProductById(id: string): Promise<Product | null>;
export declare function createProduct(data: ProductCreate): Promise<Product>;
export declare function updateProduct(id: string, data: ProductUpdate | Product): Promise<void>;
export declare function deleteProduct(id: string): Promise<void>;
//# sourceMappingURL=products.d.ts.map