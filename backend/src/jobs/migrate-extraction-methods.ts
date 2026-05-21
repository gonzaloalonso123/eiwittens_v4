// Migration: set `extraction_method` field on each product based on the
// validation results from `free-extractor-validate.ts`.
//
// Reads the most recent validation report JSON, decides per product:
//   - 'agree' / 'agree_oos' / 'gg_outdated' → free_<method>  (Layer 0)
//   - everything else → 'playwright' (current behavior, no-op)
//
// By default this is a DRY RUN — prints what would change. Pass --apply to
// actually write to Firestore.
//
// Run with:
//   pnpm tsx src/jobs/migrate-extraction-methods.ts                   # dry run
//   pnpm tsx src/jobs/migrate-extraction-methods.ts -- --apply        # write
//
// Requires FIREBASE_CREDENTIALS in backend/.env when applying.

import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractionMethod } from '@eiwittens/types';

const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'free-extractor-reports');

const FREE_METHOD_MAP: Record<string, ExtractionMethod> = {
    jsonld: 'free_jsonld',
    shopify_json: 'free_shopify',
    og: 'free_og',
    microdata: 'free_microdata',
};

// Stores where Free Extractor would systematically pick wrong variant or
// return implausible values. These keep their current 'playwright' behavior
// regardless of what the validation says.
//
// Bulk: JSON-LD master page returns cheapest variant; current XPath uses
//       Click+Select to target the right size. Confirmed via bulk-xpath-audit.
// ESN:  OG meta returns implausibly low values (€2.49 for whey); Shopify
//       endpoint is intermittent. Stays on Playwright + XPath/AI.
const BLOCKED_STORES = new Set(['Bulk', 'ESN']);

// Minimum plausible price for a supplement product. If Free Extractor returns
// less than this, we don't trust it for migration.
const MIN_PLAUSIBLE_PRICE = 1.0;

interface ValidationResult {
    productId: string;
    name: string;
    store: string;
    gg_price: number;
    free_method?: string;
    free_price?: number;
    verdict: string;
}

async function loadLatestValidation(): Promise<ValidationResult[]> {
    const files = (await readdir(REPORT_DIR)).filter((f) => f.endsWith('.json')).sort();
    if (files.length === 0) throw new Error(`No validation reports found in ${REPORT_DIR}`);
    const latest = files[files.length - 1];
    const data = JSON.parse(await readFile(resolve(REPORT_DIR, latest), 'utf-8')) as ValidationResult[];
    console.log(`[migrate] Loaded ${data.length} validation results from ${latest}`);
    return data;
}

interface MigrationItem {
    productId: string;
    name: string;
    store: string;
    target_method: ExtractionMethod;
    reason: string;
}

function planMigration(results: ValidationResult[]): { items: MigrationItem[]; blocked: ValidationResult[] } {
    const items: MigrationItem[] = [];
    const blocked: ValidationResult[] = [];

    for (const r of results) {
        if (!r.free_method) continue;
        if (BLOCKED_STORES.has(r.store)) {
            blocked.push(r);
            continue;
        }
        if (r.free_price !== undefined && r.free_price < MIN_PLAUSIBLE_PRICE) {
            blocked.push(r);
            continue;
        }

        const mapped = FREE_METHOD_MAP[r.free_method];
        if (!mapped) continue;

        if (r.verdict === 'agree' || r.verdict === 'agree_oos') {
            items.push({
                productId: r.productId,
                name: r.name,
                store: r.store,
                target_method: mapped,
                reason: `Validated: free=GG (verdict=${r.verdict})`,
            });
        } else if (r.verdict === 'gg_outdated') {
            items.push({
                productId: r.productId,
                name: r.name,
                store: r.store,
                target_method: mapped,
                reason: `GG outdated — Free Extractor will fix on switch (verdict=${r.verdict})`,
            });
        }
        // 'free_wrong', 'free_failed' → skip (keep playwright)
    }
    return { items, blocked };
}

async function applyMigration(items: MigrationItem[]): Promise<void> {
    // Dynamic import so dry-run works without Firestore creds
    const { db } = await import('../db/firebase.js');
    const collection = db.collection('products');

    let done = 0;
    for (const item of items) {
        try {
            await collection.doc(item.productId).update({ extraction_method: item.target_method });
            done++;
            console.log(`[migrate] ✓ ${done}/${items.length} ${item.store} ${item.name.slice(0, 50)} -> ${item.target_method}`);
        } catch (err) {
            console.error(`[migrate] ✗ ${item.name}: ${(err as Error).message}`);
        }
    }
    console.log(`[migrate] Done. ${done}/${items.length} products updated.`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const apply = process.argv.includes('--apply');

const results = await loadLatestValidation();
const { items: plan, blocked } = planMigration(results);

console.log(`[migrate] Plan: ${plan.length} products to mark with free_* extraction method`);
console.log(`[migrate] Blocked: ${blocked.length} products in unreliable stores (stay 'playwright')`);
console.log('');

// Summary per store
const byStore = new Map<string, MigrationItem[]>();
for (const item of plan) {
    const arr = byStore.get(item.store) ?? [];
    arr.push(item);
    byStore.set(item.store, arr);
}

console.log('Per-store summary:');
console.log('| Store | Count | Methods |');
console.log('|---|---|---|');
for (const [store, arr] of Array.from(byStore.entries()).sort((a, b) => b[1].length - a[1].length)) {
    const methods = Array.from(new Set(arr.map((i) => i.target_method))).join(', ');
    console.log(`| ${store} | ${arr.length} | ${methods} |`);
}
console.log('');

if (!apply) {
    console.log('[migrate] DRY RUN — pass --apply to actually write to Firestore');
    console.log('');
    console.log('Sample of products that would be migrated:');
    for (const item of plan.slice(0, 10)) {
        console.log(`  ${item.store} | ${item.name.slice(0, 50)} -> ${item.target_method}`);
    }
    console.log(`  ... and ${plan.length - 10} more`);
} else {
    console.log('[migrate] APPLYING migration to Firestore...');
    if (!process.env.FIREBASE_CREDENTIALS) {
        console.error('[migrate] FIREBASE_CREDENTIALS not set. Cannot apply. Run dry-run first.');
        process.exit(1);
    }
    await applyMigration(plan);
}

process.exit(0);
