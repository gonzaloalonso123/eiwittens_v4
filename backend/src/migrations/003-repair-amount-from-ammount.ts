/**
 * Migration 003: Repair amount values from the legacy ammount field.
 *
 * This fixes products where migration 002 created amount: 0 before migration 001
 * could rename ammount to amount. It copies a positive legacy ammount value over
 * missing, invalid, or zero amount values, removes the legacy field, recalculates
 * stale warning flags, and rebuilds computed price fields from repaired data.
 *
 * Usage:
 *   pnpm --filter eiwittens-backend migrate:repair-amount
 *   DRY_RUN=true pnpm --filter eiwittens-backend migrate:repair-amount
 */

import { configDotenv } from 'dotenv';
configDotenv();

import admin from 'firebase-admin';
import { config } from '../config.js';
import { applyCalculations } from '../pipeline/calculations.js';
import { applyWarnings } from '../pipeline/warnings.js';
import type { Product } from '@eiwittens/types';

const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 500;

const serviceAccount = JSON.parse(
    Buffer.from(config.FIREBASE_CREDENTIALS, 'base64').toString('utf-8'),
) as admin.ServiceAccount;

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const computedFields = [
    'price_for_element_gram',
    'price_per_dose',
    'price_per_100_calories',
    'price_per_1000_calories',
] as const satisfies readonly (keyof Product)[];

async function migrate(): Promise<void> {
    console.log('\nMigration 003: Repair amount from legacy ammount and recalculate prices');
    console.log(`   Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}\n`);

    const snapshot = await db.collection('products').get();
    console.log(`   Found ${snapshot.size} products\n`);

    const batches: admin.firestore.WriteBatch[] = [];
    let currentBatch = db.batch();
    let operationsInBatch = 0;
    let repaired = 0;
    let cleaned = 0;
    let warningsUpdated = 0;
    let calculationsUpdated = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const updates: Record<string, unknown> = {};
        const fixedProduct = { ...data, id: doc.id } as Product;

        if ('ammount' in data) {
            const legacyAmount = coercePositiveNumber(data['ammount']);
            const currentAmount = coercePositiveNumber(data['amount']);
            updates['ammount'] = admin.firestore.FieldValue.delete();

            if (legacyAmount !== undefined && currentAmount === undefined) {
                updates['amount'] = legacyAmount;
                fixedProduct.amount = legacyAmount;
                repaired++;
            } else {
                if (currentAmount !== undefined) {
                    fixedProduct.amount = currentAmount;
                    if (data['amount'] !== currentAmount) {
                        updates['amount'] = currentAmount;
                        repaired++;
                    }
                }
                cleaned++;
            }
        } else {
            const currentAmount = coercePositiveNumber(data['amount']);
            if (currentAmount !== undefined && data['amount'] !== currentAmount) {
                updates['amount'] = currentAmount;
                fixedProduct.amount = currentAmount;
                repaired++;
            }
        }

        const recalculated = applyWarnings(applyCalculations([fixedProduct]))[0];

        if (data['warning'] !== recalculated.warning) {
            updates['warning'] = recalculated.warning;
            warningsUpdated++;
        }

        for (const field of computedFields) {
            const current = data[field];
            const next = recalculated[field];

            if (next === undefined) {
                if (current !== undefined && current !== null) {
                    updates[field] = admin.firestore.FieldValue.delete();
                    calculationsUpdated++;
                }
            } else if (current !== next) {
                updates[field] = next;
                calculationsUpdated++;
            }
        }

        if (Object.keys(updates).length === 0) continue;

        if (DRY_RUN) {
            console.log(`   [dry-run] ${doc.id} (${data['name'] ?? 'unnamed'}): ${JSON.stringify(Object.keys(updates))}`);
        } else {
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

    console.log(
        `\nDone. Repaired ${repaired} product amount value(s), ` +
        `cleaned ${cleaned} legacy field(s), updated ${warningsUpdated} warning flag(s), ` +
        `updated ${calculationsUpdated} computed price field(s).`,
    );
    if (DRY_RUN) {
        console.log('   (Dry run - no changes written)\n');
    }
    process.exit(0);
}

migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});

function coercePositiveNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;

    const normalized = normalizeNumericString(String(value));
    if (!normalized) return undefined;

    const numberValue = Number(normalized);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function normalizeNumericString(value: string): string | undefined {
    const cleaned = value.trim().replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
    if (!/\d/.test(cleaned)) return undefined;

    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');

    if (lastComma >= 0 && lastDot >= 0) {
        const decimalSeparator = lastComma > lastDot ? ',' : '.';
        const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
        return cleaned
            .replace(new RegExp(`\\${thousandsSeparator}`, 'g'), '')
            .replace(decimalSeparator, '.');
    }

    if (lastComma >= 0) return normalizeSingleSeparator(cleaned, ',');
    if (lastDot >= 0) return normalizeSingleSeparator(cleaned, '.');

    return cleaned;
}

function normalizeSingleSeparator(value: string, separator: ',' | '.'): string {
    const separatorIndex = value.lastIndexOf(separator);
    const decimals = value.length - separatorIndex - 1;

    if (decimals === 3) {
        return value.replace(new RegExp(`\\${separator}`, 'g'), '');
    }

    return value.replace(separator, '.');
}