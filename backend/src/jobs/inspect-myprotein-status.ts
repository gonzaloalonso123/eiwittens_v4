/**
 * Snapshot the current state of all MyProtein products after today's changes.
 * Groups by extraction_method so we can spot-check which products are now
 * on the Awin feed, which run via Playwright with AI-verified selectors, etc.
 */
import 'dotenv/config';
import { db } from '../db/firebase.js';
import type { Product } from '@eiwittens/types';

async function main(): Promise<void> {
    const snap = await db.collection('products').where('store', '==', 'MyProtein').get();
    const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) })) as Product[];
    const active = all.filter((p) => p.enabled);
    const disabled = all.filter((p) => !p.enabled);

    console.log(`MyProtein — ${all.length} totaal (${active.length} actief, ${disabled.length} disabled)\n`);

    const groups = new Map<string, Product[]>();
    for (const p of active) {
        const k = p.extraction_method ?? 'playwright (default)';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(p);
    }

    const sortedGroups = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
    for (const [method, products] of sortedGroups) {
        console.log(`\n=== ${method} (${products.length}) ===\n`);
        for (const p of products.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))) {
            const verified = p.ai_verified_at ? '✓verified' : '       ';
            const aiPrice = p.ai_verified_price !== undefined ? `(ai-saw €${p.ai_verified_price.toFixed(2)})` : '';
            console.log(`  ${verified}  €${String((p.price ?? 0).toFixed(2)).padStart(7)}  ${String(p.amount).padStart(5)}g  ${p.name}  ${aiPrice}`);
            console.log(`              ${(p.url ?? '').slice(0, 110)}`);
        }
    }

    if (disabled.length > 0) {
        console.log(`\n=== Disabled (${disabled.length}) ===\n`);
        for (const p of disabled.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))) {
            console.log(`            €${String((p.price ?? 0).toFixed(2)).padStart(7)}  ${String(p.amount).padStart(5)}g  ${p.name}`);
        }
    }
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Failed:', err);
    process.exit(1);
});
