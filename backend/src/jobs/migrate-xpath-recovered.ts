// Step 1: migrate xpath_recovered_by_free products to use Free Extractor.
// Reads the latest full-validation-audit, finds products where XPath failed
// but Free Extractor returned a price, and sets extraction_method=free_<method>.
//
// Run with:
//   pnpm tsx src/jobs/migrate-xpath-recovered.ts             # dry run
//   pnpm tsx src/jobs/migrate-xpath-recovered.ts -- --apply  # write to Firestore

import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractionMethod } from '@eiwittens/types';

const AUDIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'full-audit-reports');

const FREE_METHOD_MAP: Record<string, ExtractionMethod> = {
    jsonld: 'free_jsonld',
    shopify_json: 'free_shopify',
    og: 'free_og',
    microdata: 'free_microdata',
};

interface AuditResult {
    productId: string;
    name: string;
    store: string;
    verdict: string;
    free_method?: string;
    free_price?: number;
}

const apply = process.argv.includes('--apply');
console.log(`[migrate-recovered] Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

const files = (await readdir(AUDIT_DIR)).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
    console.error('No full-audit reports found');
    process.exit(1);
}
const audit = JSON.parse(await readFile(resolve(AUDIT_DIR, files[files.length - 1]), 'utf-8')) as AuditResult[];
console.log(`[migrate-recovered] Loaded ${audit.length} audit results from ${files[files.length - 1]}`);

const candidates = audit.filter((r) => r.verdict === 'xpath_recovered_by_free' && r.free_method);
console.log(`[migrate-recovered] ${candidates.length} candidates for Layer 0 migration`);

// Group by free_method
const byMethod: Record<string, number> = {};
for (const c of candidates) byMethod[c.free_method!] = (byMethod[c.free_method!] ?? 0) + 1;
console.log('');
console.log('By extraction method:');
for (const [m, n] of Object.entries(byMethod)) console.log(`  free_${m}: ${n}`);

// Group by store
console.log('');
console.log('By store (top 15):');
const byStore: Record<string, number> = {};
for (const c of candidates) byStore[c.store] = (byStore[c.store] ?? 0) + 1;
for (const [s, n] of Object.entries(byStore).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${s}: ${n}`);
}

if (!apply) {
    console.log('');
    console.log('[migrate-recovered] DRY RUN — pass --apply to write to Firestore');
    process.exit(0);
}

console.log('');
console.log('[migrate-recovered] APPLYING extraction_method updates...');
const { db } = await import('../db/firebase.js');
const collection = db.collection('products');

let updated = 0;
let failed = 0;
for (const c of candidates) {
    const method = FREE_METHOD_MAP[c.free_method!];
    if (!method) continue;
    try {
        await collection.doc(c.productId).update({ extraction_method: method });
        updated++;
        if (updated % 25 === 0) console.log(`  ${updated}/${candidates.length}...`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${c.name}: ${(err as Error).message}`);
    }
}
console.log('');
console.log(`[migrate-recovered] Done. ${updated} updated, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
