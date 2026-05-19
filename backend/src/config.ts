import { configDotenv } from 'dotenv';
import { z } from 'zod';

// Load .env before parsing — safe to call multiple times (no-op if already loaded)
configDotenv();

const envSchema = z.object({
    PORT: z.coerce.number().default(8080),
    FIREBASE_CREDENTIALS: z.string().min(1, 'FIREBASE_CREDENTIALS (base64 service account JSON) is required'),
    OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
    GMAIL_USER: z.string().email('GMAIL_USER must be a valid email address'),
    GMAIL_PASSWORD: z.string().min(1, 'GMAIL_PASSWORD is required'),
    SCRAPE_SECRET: z.string().min(1, 'SCRAPE_SECRET (bearer token) is required'),
    SCRAPE_CONCURRENCY: z.coerce.number().int().positive().default(3),
    SCRAPE_STALE_AFTER_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    SCRAPE_LIMIT: z.coerce.number().int().positive().optional(),
    SCRAPE_PRODUCT_ID: z.string().min(1).optional(),
    ALERT_RECIPIENTS: z.string().default('huntymonster@gmail.com,gieriggroeien.nl@gmail.com'),
    ALLOWED_WARNINGS: z.coerce.number().int().nonnegative().default(15),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(JSON.stringify(result.error.flatten().fieldErrors, null, 2));
    process.exit(1);
}

export const config = result.data;
