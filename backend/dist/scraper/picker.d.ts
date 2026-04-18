export interface PickElementResult {
    text: string;
    tagName: string;
    css: string;
    xpath: string;
}
export declare function pickElementAtPoint(url: string, x: number, y: number, cookieBannerXPaths: string[]): Promise<PickElementResult | null>;
export declare function takePageScreenshot(url: string, cookieBannerXPaths: string[]): Promise<string>;
//# sourceMappingURL=picker.d.ts.map