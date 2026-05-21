// Step 3: add ClickByText action to Bulk products that have silently_wrong scrape.
// Bulk's master product page JSON-LD returns the cheapest variant. The fix is to
// click the right size button before reading the price. We add a ClickByText
// action at the START of the existing scraper config.
//
// Pre-action sequence (prepended):
//   1. ClickByText("<size>") — selects the variant matching product.amount
//   2. Wait(1500ms) — let JS update the price
//
// Existing scraper actions stay in place after these.

import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActionType, type ScraperAction } from '@eiwittens/types';

const AUDIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'full-audit-reports');
const BACKEND_API = 'https://eiwittens-backend-16129604687.europe-west4.run.app';

interface AuditResult {
    productId: string;
    name: string;
    store: string;
    gg_amount?: number;
    verdict: string;
}

interface FullProduct {
    id: string;
    name: string;
    amount?: number;
    scraper: ScraperAction[];
}

function amountToSizeLabel(grams: number | undefined): string | null {
    if (!grams || grams <= 0) return null;
    if (grams >= 1000) {
        const kg = grams / 1000;
        // Bulk uses formats like "1kg", "2.5kg", "5kg"
        return kg % 1 === 0 ? `${kg}kg` : `${kg.toString().replace('.', ',')}kg`;
    }
    return `${grams}g`;
}

const apply = process.argv.includes('--apply');
console.log(`[bulk-fix] Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

const files = (await readdir(AUDIT_DIR)).filter((f) => f.endsWith('.json')).sort();
const audit = JSON.parse(await readFile(resolve(AUDIT_DIR, files[files.length - 1]), 'utf-8')) as AuditResult[];

const targets = audit.filter((r) => r.store === 'Bulk' && r.verdict === 'silently_wrong');
console.log(`[bulk-fix] Targeting ${targets.length} Bulk silently_wrong products`);

interface Plan {
    productId: string;
    name: string;
    amount?: number;
    size_label: string | null;
    action: 'inject_clickbytext' | 'skip_no_amount';
    new_scraper?: ScraperAction[];
}

const plans: Plan[] = [];
for (const t of targets) {
    const size = amountToSizeLabel(t.gg_amount);
    if (!size) {
        plans.push({ productId: t.productId, name: t.name, amount: t.gg_amount, size_label: null, action: 'skip_no_amount' });
        continue;
    }

    // Fetch existing scraper config
    const detail = await fetch(`${BACKEND_API}/products/${t.productId}`).then((r) => r.json()) as FullProduct;
    const existingActions = detail.scraper ?? [];

    // Skip if ClickByText already present (e.g., from prior run)
    if (existingActions.some((a) => a.type === ActionType.ClickByText)) {
        plans.push({ productId: t.productId, name: t.name, amount: t.gg_amount, size_label: size, action: 'skip_no_amount', new_scraper: existingActions });
        continue;
    }

    // Prepend ClickByText + Wait, keep existing actions
    const newActions: ScraperAction[] = [
        { id: crypto.randomUUID(), type: ActionType.ClickByText, text: size },
        { id: crypto.randomUUID(), type: ActionType.Wait, duration: 1500 },
        ...existingActions,
    ];
    plans.push({ productId: t.productId, name: t.name, amount: t.gg_amount, size_label: size, action: 'inject_clickbytext', new_scraper: newActions });
}

const counts = { inject_clickbytext: 0, skip_no_amount: 0 };
for (const p of plans) counts[p.action]++;

console.log('');
console.log(`[bulk-fix] Plan: ${counts.inject_clickbytext} inject ClickByText | ${counts.skip_no_amount} skip`);
console.log('');
console.log('Sample plans:');
for (const p of plans.slice(0, 10)) {
    console.log(`  ${p.name.slice(0, 50)} — amount=${p.amount}g → ClickByText("${p.size_label}")`);
}
if (plans.length > 10) console.log(`  ... and ${plans.length - 10} more`);

if (!apply) {
    console.log('');
    console.log('[bulk-fix] DRY RUN — pass --apply to write to Firestore');
    process.exit(0);
}

console.log('');
console.log('[bulk-fix] APPLYING...');
const { db } = await import('../db/firebase.js');
const collection = db.collection('products');

let updated = 0;
let failed = 0;
for (const p of plans) {
    if (p.action !== 'inject_clickbytext' || !p.new_scraper) continue;
    try {
        await collection.doc(p.productId).update({ scraper: p.new_scraper });
        updated++;
    } catch (err) {
        failed++;
        console.error(`  ✗ ${p.name}: ${(err as Error).message}`);
    }
}
console.log(`[bulk-fix] Done. ${updated} updated, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
