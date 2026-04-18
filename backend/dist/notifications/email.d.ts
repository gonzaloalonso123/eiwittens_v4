import type { Warning } from '../pipeline/warnings.js';
import type { Product } from '@eiwittens/types';
export declare function sendWarningDigest(warnings: Warning[], products: Product[]): Promise<void>;
export declare function sendErrorAlert(message: string): Promise<void>;
//# sourceMappingURL=email.d.ts.map