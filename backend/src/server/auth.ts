import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { config } from '../config.js';

/**
 * Combined auth middleware: accepts either a Firebase Auth ID token or
 * the SCRAPE_SECRET bearer token. This allows both human dashboard users
 * (Firebase Auth) and automated cron jobs (SCRAPE_SECRET) to call
 * protected endpoints.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing Authorization header' });
        return;
    }

    const token = header.slice(7);

    // Check if it's the static scrape secret first (fast path for cron jobs)
    if (token === config.SCRAPE_SECRET) {
        next();
        return;
    }

    // Otherwise treat it as a Firebase Auth ID token
    admin
        .auth()
        .verifyIdToken(token)
        .then(() => next())
        .catch(() => {
            res.status(401).json({ error: 'Invalid or expired token' });
        });
}
