import { ProductType, DiscountType, ActionType } from './enums.js';
export declare const productTypes: ReadonlyArray<{
    value: ProductType;
    label: string;
}>;
export declare const productSubtypes: Readonly<Record<ProductType, ReadonlyArray<{
    value: string;
    label: string;
}>>>;
export declare const discountTypes: ReadonlyArray<{
    value: DiscountType;
    label: string;
}>;
export declare const actionTypes: ReadonlyArray<{
    value: ActionType;
    label: string;
}>;
//# sourceMappingURL=constants.d.ts.map