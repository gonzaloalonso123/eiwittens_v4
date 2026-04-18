import type { Page } from 'playwright';
export interface DriverHandle {
    page: Page;
    cleanup: () => Promise<void>;
}
export declare function createDriver(): Promise<DriverHandle>;
//# sourceMappingURL=driver.d.ts.map