/**
 * Migration 001: Rename fields to match new schema
 *
 * Changes:
 * - ammount → amount
 * - trustPilotScore → trustpilot_score
 * - discount_type: 'flat' → 'fixed'
 * - scraper[].selector → scraper[].selectorType
 * - scraper[].xpath → scraper[].selectorValue
 * - scraper[].id added (generated UUID)
 * - count_top10 → deleted
 * - New fields with defaults: store, out_of_stock, enabled_top10, only_in_store, ingredients, discount_code, subtypes, image
 *
 * Usage:
 *   pnpm --filter eiwittens-backend migrate
 *   DRY_RUN=true pnpm --filter eiwittens-backend migrate
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

interface OldScraperAction {
    type: string;
    selector?: string;
    xpath?: string;
    optionText?: string;
    duration?: number;
    // May already have new fields if partially migrated
    id?: string;
    selectorType?: string;
    selectorValue?: string;
}

async function migrate(): Promise<void> {
    console.log(`\n🚀 Migration 001: Rename fields`);
    console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}\n`);

    const snapshot = await db.collection('products').get();
    console.log(`   Found ${snapshot.size} products\n`);

    const batches: admin.firestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let operationsInBatch = 0;
    let totalMigrated = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const updates: Record<string, unknown> = {};
        const deletes: string[] = [];

        // ── Field renames ──────────────────────────────────────────────────

        // ammount → amount
        if ('ammount' in data) {
            const legacyAmount = coercePositiveNumber(data['ammount']);
            const currentAmount = coercePositiveNumber(data['amount']);

            if (legacyAmount !== undefined && currentAmount === undefined) {
                updates['amount'] = legacyAmount;
            }
            deletes.push('ammount');
        }

        // trustPilotScore → trustpilot_score
        if ('trustPilotScore' in data && !('trustpilot_score' in data)) {
            updates['trustpilot_score'] = data['trustPilotScore'];
            deletes.push('trustPilotScore');
        }

        // discount_type: 'flat' → 'fixed'
        if (data['discount_type'] === 'flat') {
            updates['discount_type'] = 'fixed';
        }

        // ── ScraperAction array transform ───────────────────────────────────

        const oldScraper = data['scraper'] as OldScraperAction[] | undefined;
        if (Array.isArray(oldScraper) && oldScraper.length > 0) {
            const needsTransform = oldScraper.some(
                (a) => ('selector' in a && !('selectorType' in a)) || ('xpath' in a && !('selectorValue' in a)) || !a.id,
            );

            if (needsTransform) {
                updates['scraper'] = oldScraper.map((action) => {
                    const migrated: Record<string, unknown> = {
                        id: action.id ?? crypto.randomUUID(),
                        type: action.type,
                    };

                    if (action.type === 'wait') {
                        if (action.duration !== undefined) {
                            migrated['duration'] = action.duration;
                        }
                    } else {
                        // click, select, selectOption
                        migrated['selectorType'] = action.selectorType ?? action.selector ?? 'xpath';
                        migrated['selectorValue'] = action.selectorValue ?? action.xpath ?? '';

                        if (action.type === 'selectOption' && action.optionText) {
                            migrated['optionText'] = action.optionText;
                        }
                    }

                    return migrated;
                });
            }
        }

        // ── Delete removed fields ───────────────────────────────────────────

        if ('count_top10' in data) {
            deletes.push('count_top10');
        }

        // ── New fields with defaults ────────────────────────────────────────

        if (!('store' in data)) updates['store'] = '';
        if (!('out_of_stock' in data)) updates['out_of_stock'] = false;
        if (!('enabled_top10' in data)) updates['enabled_top10'] = true;
        if (!('only_in_store' in data)) updates['only_in_store'] = false;
        if (!('ingredients' in data)) updates['ingredients'] = [];
        if (!('discount_code' in data)) updates['discount_code'] = '';
        if (!('subtypes' in data)) updates['subtypes'] = [];

        // ── Apply updates ───────────────────────────────────────────────────

        const hasChanges = Object.keys(updates).length > 0 || deletes.length > 0;
        if (!hasChanges) continue;

        // Merge deletes into updates using FieldValue.delete()
        for (const field of deletes) {
            updates[field] = admin.firestore.FieldValue.delete();
        }

        if (DRY_RUN) {
            console.log(`   [dry-run] ${doc.id} (${data['name'] ?? 'unnamed'}):`);
            console.log(`     Updates: ${JSON.stringify(Object.keys(updates))}`);
        } else {
            currentBatch.update(doc.ref, updates);
            operationsInBatch++;

            if (operationsInBatch >= BATCH_SIZE) {
                batches.push(currentBatch);
                currentBatch = db.batch();
                operationsInBatch = 0;
            }
        }

        totalMigrated++;
    }

    // Commit remaining batch
    if (operationsInBatch > 0) {
        batches.push(currentBatch);
    }

    if (!DRY_RUN) {
        console.log(`   Committing ${batches.length} batch(es)...`);
        for (let i = 0; i < batches.length; i++) {
            await batches[i].commit();
            console.log(`   Batch ${i + 1}/${batches.length} committed`);
        }
    }

    console.log(`\n✅ Migration complete: ${totalMigrated}/${snapshot.size} products updated\n`);
}

migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});

function coercePositiveNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}
