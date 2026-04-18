import type { Request, Response, NextFunction } from 'express';
/**
 * Combined auth middleware: accepts either a Firebase Auth ID token or
 * the SCRAPE_SECRET bearer token. This allows both human dashboard users
 * (Firebase Auth) and automated cron jobs (SCRAPE_SECRET) to call
 * protected endpoints.
 */
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map