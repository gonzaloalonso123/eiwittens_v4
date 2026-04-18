/**
 * Migration 002: Coerce field types to match Product interface
 *
 * Firestore may store numbers as strings, booleans as strings, etc.
 * This migration ensures all fields match the expected TypeScript types.
 *
 * Usage:
 *   npx tsx src/migrations/002-coerce-types.ts
 *   DRY_RUN=true npx tsx src/migrations/002-coerce-types.ts
 */

import { configDotenv } from 'dotenv';
configDotenv();

import admin from 'firebase-admin';
import { config } from '../config.js';

const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 500;

const serviceAccount = JSON.parse(
    Buffer.from(config.FIREBASE_CREDENTIALS, 'base64').toString('utf-8'),
) as admin.ServiceAccount;

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ── Field type definitions ───────────────────────────────────────────────────

type FieldType = 'number' | 'boolean' | 'string' | 'array';

const numericFields: string[] = [
    'price',
    'amount',
    'dose',
    'protein_per_100g',
    'creatine_per_100g',
    'sugar_per_100g',
    'calories_per_100g',
    'caffeine_per_100g',
    'beta_alanine_per_100g',
    'citrulline_per_100g',
    'tyrosine_per_100g',
    'discount_value',
    'trustpilot_score',
    'provisional_price',
    'price_for_element_gram',
    'price_per_dose',
    'price_per_100_calories',
    'price_per_1000_calories',
];

const booleanFields: string[] = [
    'enabled',
    'scrape_enabled',
    'out_of_stock',
    'enabled_top10',
    'only_in_store',
    'warning',
];

const stringFields: string[] = [
    'name',
    'store',
    'url',
    'image',
    'type',
    'discount_type',
    'discount_code',
    'trustpilot_url',
];

const arrayFields: string[] = [
    'subtypes',
    'scraper',
    'cookieBannerXPaths',
    'ingredients',
    'count_clicked',
];

function coerceNumber(val: unknown): number | undefined {
    if (val === null || val === undefined || val === '') return undefined;
    const n = Number(val);
    return isNaN(n) ? undefined : n;
}

function coerceBoolean(val: unknown): boolean {
    if (typeof val === 'boolean') return val;
    if (val === 'true' || val === 1) return true;
    if (val === 'false' || val === 0 || val === null || val === undefined) return false;
    return Boolean(val);
}

function coerceString(val: unknown): string | undefined {
    if (val === null || val === undefined) return undefined;
    return String(val);
}

async function migrate(): Promise<void> {
    console.log(`\n🚀 Migration 002: Coerce field types`);
    console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}\n`);

    const snapshot = await db.collection('products').get();
    console.log(`   Found ${snapshot.size} products\n`);

    const batches: admin.firestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let operationsInBatch = 0;
    let totalFixed = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const updates: Record<string, unknown> = {};
        const fixes: string[] = [];

        // ── Numeric fields ─────────────────────────────────────────────────
        for (const field of numericFields) {
            if (!(field in data)) continue;
            const val = data[field];
            if (typeof val === 'number') continue;

            const coerced = coerceNumber(val);
            if (coerced !== undefined) {
                updates[field] = coerced;
                fixes.push(`${field}: ${JSON.stringify(val)} → ${coerced}`);
            } else if (val !== undefined && val !== null) {
                // Non-parseable, remove it
                updates[field] = admin.firestore.FieldValue.delete();
                fixes.push(`${field}: ${JSON.stringify(val)} → (deleted, not a number)`);
            }
        }

        // ── Boolean fields ─────────────────────────────────────────────────
        for (const field of booleanFields) {
            if (!(field in data)) continue;
            const val = data[field];
            if (typeof val === 'boolean') continue;

            updates[field] = coerceBoolean(val);
            fixes.push(`${field}: ${JSON.stringify(val)} → ${coerceBoolean(val)}`);
        }

        // ── String fields ──────────────────────────────────────────────────
        for (const field of stringFields) {
            if (!(field in data)) continue;
            const val = data[field];
            if (typeof val === 'string') continue;
            if (val === null || val === undefined) continue;

            updates[field] = String(val);
            fixes.push(`${field}: ${JSON.stringify(val)} → "${String(val)}"`);
        }

        // ── Array fields (ensure they are arrays) ──────────────────────────
        for (const field of arrayFields) {
            if (!(field in data)) continue;
            const val = data[field];
            if (Array.isArray(val)) continue;

            if (val === null || val === undefined) {
                updates[field] = [];
                fixes.push(`${field}: ${JSON.stringify(val)} → []`);
            }
            // If it's some other type, wrap in array or reset
            else {
                updates[field] = [];
                fixes.push(`${field}: ${typeof val} → []`);
            }
        }

        // ── Ensure required defaults exist ─────────────────────────────────
        const defaults: Record<string, unknown> = {
            subtypes: [],
            ingredients: [],
            scraper: [],
            enabled: true,
            scrape_enabled: true,
            out_of_stock: false,
            enabled_top10: true,
            only_in_store: false,
            price: 0,
            amount: 0,
        };

        for (const [field, defaultVal] of Object.entries(defaults)) {
            if (!(field in data) && !(field in updates)) {
                updates[field] = defaultVal;
                fixes.push(`${field}: (missing) → ${JSON.stringify(defaultVal)}`);
            }
        }

        if (Object.keys(updates).length === 0) continue;

        totalFixed++;
        console.log(`   📦 ${doc.id} (${data['name'] ?? 'unnamed'}):`);
        for (const fix of fixes) {
            console.log(`      - ${fix}`);
        }

        if (!DRY_RUN) {
            currentBatch.update(doc.ref, updates);
            operationsInBatch++;

            if (operationsInBatch >= BATCH_SIZE) {
                batches.push(currentBatch);
                currentBatch = db.batch();
                operationsInBatch = 0;
            }
        }
    }

    if (operationsInBatch > 0) {
        batches.push(currentBatch);
    }

    if (!DRY_RUN && batches.length > 0) {
        console.log(`\n   Writing ${batches.length} batch(es)...`);
        for (const batch of batches) {
            await batch.commit();
        }
    }

    console.log(`\n✅ Done. Fixed ${totalFixed}/${snapshot.size} products.`);
    if (DRY_RUN) {
        console.log('   (Dry run — no changes written)\n');
    }
    process.exit(0);
}

migrate().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
