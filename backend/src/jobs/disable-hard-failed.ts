// Step 5: disable products that hard_failed in the full validation audit.
// Both XPath and Free Extractor failed on these — they're either dead URLs,
// anti-bot blocks too aggressive for stealth Playwright, or broken scraper configs.
//
// Disable = set enabled=false + scrape_enabled=false + out_of_stock=true.
// This removes them from the live site but keeps the record (can re-enable later).
//
// Run with:
//   pnpm tsx src/jobs/disable-hard-failed.ts             # dry run
//   pnpm tsx src/jobs/disable-hard-failed.ts -- --apply  # write to Firestore

import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'full-audit-reports');

interface AuditResult {
    productId: string;
    name: string;
    store: string;
    verdict: string;
    xpath_error?: string;
    free_error?: string;
}

const apply = process.argv.includes('--apply');
console.log(`[disable-failed] Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

const files = (await readdir(AUDIT_DIR)).filter((f) => f.endsWith('.json')).sort();
const audit = JSON.parse(await readFile(resolve(AUDIT_DIR, files[files.length - 1]), 'utf-8')) as AuditResult[];
const rawTargets = audit.filter((r) => r.verdict === 'hard_failed');

console.log(`[disable-failed] ${rawTargets.length} hard_failed candidates from audit`);

// Re-fetch live products to filter out ones that have been fixed since audit
console.log('[disable-failed] Re-fetching live product state...');
const liveProducts = await fetch('https://eiwittens-backend-16129604687.europe-west4.run.app/products?type=MINIMAL')
    .then((r) => r.json()) as Array<{ id: string; extraction_method?: string }>;
const liveById = new Map(liveProducts.map((p) => [p.id, p]));

const targets = rawTargets.filter((t) => {
    const live = liveById.get(t.productId);
    if (!live) return false; // Product no longer exists
    // If extraction_method has been set (i.e., fixed in Steps 1/2), skip
    if (live.extraction_method && live.extraction_method !== 'playwright') return false;
    return true;
});

console.log(`[disable-failed] After filtering fixed-since-audit: ${targets.length} to disable`);
console.log('');

// Per-store summary
const byStore: Record<string, number> = {};
for (const t of targets) byStore[t.store] = (byStore[t.store] ?? 0) + 1;
console.log('By store:');
for (const [s, n] of Object.entries(byStore).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
}
console.log('');

// Show error type breakdown
const errorPattern: Record<string, number> = {};
for (const t of targets) {
    const xerr = (t.xpath_error ?? '').toLowerCase();
    const ferr = (t.free_error ?? '').toLowerCase();
    let kind = 'other';
    if (xerr.includes('timeout') || ferr.includes('timeout')) kind = 'timeout';
    else if (xerr.includes('404') || ferr.includes('404')) kind = '404';
    else if (xerr.includes('403') || ferr.includes('403')) kind = '403_antibot';
    else if (xerr.includes('no scraper actions configured')) kind = 'no_scraper_config';
    else if (xerr.includes('empty/zero')) kind = 'empty_price';
    errorPattern[kind] = (errorPattern[kind] ?? 0) + 1;
}
console.log('Error patterns:');
for (const [k, n] of Object.entries(errorPattern).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
}

if (!apply) {
    console.log('');
    console.log('[disable-failed] DRY RUN — pass --apply to disable in Firestore');
    process.exit(0);
}

console.log('');
console.log('[disable-failed] APPLYING (disabling)...');
const { db } = await import('../db/firebase.js');
const collection = db.collection('products');

let updated = 0;
let failed = 0;
for (const t of targets) {
    try {
        await collection.doc(t.productId).update({
            enabled: false,
            scrape_enabled: false,
            out_of_stock: true,
        });
        updated++;
        if (updated % 25 === 0) console.log(`  ${updated}/${targets.length}...`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${t.name}: ${(err as Error).message}`);
    }
}
console.log('');
console.log(`[disable-failed] Done. ${updated} disabled, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
