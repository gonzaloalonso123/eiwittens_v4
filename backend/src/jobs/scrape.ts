import { scrapeAndPushResumable } from '../pipeline/index.js';

try {
    const result = await scrapeAndPushResumable();
    console.log('[job:scrape] Completed', result);
    process.exit(0);
} catch (err) {
    console.error('[job:scrape] Failed', err);
    process.exit(1);
}
