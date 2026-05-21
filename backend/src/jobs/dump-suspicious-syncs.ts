/**
 * Find products where today's verification produced a suspicious price change.
 *
 * Heuristics for "suspicious":
 *   1. Large drop (>50% reduction) — likely AI picked wrong variant
 *   2. Multiple variants of same shop+product family share an identical
 *      ai_verified_price — AI saw the default variant for all of them
 *   3. Large increase (>200%) — possibly a unit mismatch
 *
 * Output: a markdown review file with current price, AI price, percent change,
 * URL, and dashboard edit link per suspicious case.
 *
 * Usage:
 *   pnpm tsx src/jobs/dump-suspicious-syncs.ts <out-path>
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { db } from '../db/firebase.js';
import type { Product } from '@eiwittens/types';

const DASHBOARD = 'https://dashboard.gieriggroeien.nl/dashboard/products/edit/';
const MAX_AGE_DAYS = 7;
const BIG_DROP_PCT = 50;     // drop ≥ 50% → suspicious
const BIG_INCREASE_PCT = 200; // increase ≥ 200% → suspicious

function ageInDays(value: Product['ai_verified_at']): number | null {
    if (!value) return null;
    if (value instanceof Date) return (Date.now() - value.getTime()) / 86_400_000;
    if (typeof value === 'object' && 'seconds' in value) return (Date.now() - value.seconds * 1000) / 86_400_000;
    return null;
}

interface Suspect {
    product: Product;
    reason: string;
    livePrice: number;
    verifiedPrice: number;
    changePct: number;
    direction: 'drop' | 'rise' | 'cluster';
}

async function main(): Promise<void> {
    const outPath = process.argv[2];
    if (!outPath) {
        console.error('Usage: pnpm tsx src/jobs/dump-suspicious-syncs.ts <out-path>');
        process.exit(1);
    }

    const snap = await db.collection('products').get();
    const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) })) as Product[];

    const recent = all.filter((p) => {
        if (!p.enabled) return false;
        const age = ageInDays(p.ai_verified_at);
        return age !== null && age <= MAX_AGE_DAYS && typeof p.ai_verified_price === 'number';
    });
    console.log(`${recent.length} products have a fresh ai_verified_price`);

    const suspects: Suspect[] = [];

    // ── Heuristic 1 & 3: big drops / big rises ──────────────────────────
    // After sync-prices ran, the live `price` field equals ai_verified_price for
    // most products. To detect the change we look at price_history for the most
    // recent value BEFORE today's verification. If that doesn't exist, fall back
    // to comparing live vs verified (catches products that weren't synced).
    function previousPrice(p: Product): number {
        const live = p.price ?? 0;
        const verified = p.ai_verified_price ?? 0;
        if (live > 0 && Math.abs(live - verified) / Math.max(live, verified) > 0.01) {
            return live;
        }
        const hist = p.price_history ?? [];
        // Walk history backwards, find first entry whose value materially differs
        // from current price (more than 1%). That's the "before" price.
        for (let i = hist.length - 1; i >= 0; i -= 1) {
            const v = hist[i].scrapedData;
            if (typeof v !== 'number' || v <= 0) continue;
            if (Math.abs(v - live) / Math.max(v, live) > 0.01) return v;
        }
        return live; // no historic difference found
    }

    for (const p of recent) {
        const verified = p.ai_verified_price!;
        const prev = previousPrice(p);
        if (prev <= 0 || verified <= 0) continue;
        if (Math.abs(prev - verified) / Math.max(prev, verified) <= 0.01) continue;
        const max = Math.max(prev, verified);
        const min = Math.min(prev, verified);
        const changePct = ((max - min) / min) * 100;

        if (verified < prev && changePct >= BIG_DROP_PCT) {
            suspects.push({ product: p, reason: `big drop ${changePct.toFixed(0)}%`, livePrice: prev, verifiedPrice: verified, changePct, direction: 'drop' });
        } else if (verified > prev && changePct >= BIG_INCREASE_PCT && prev > 5) {
            suspects.push({ product: p, reason: `big rise ${changePct.toFixed(0)}%`, livePrice: prev, verifiedPrice: verified, changePct, direction: 'rise' });
        }
    }

    // ── Heuristic 2: same shop, same product family, identical AI price ──
    // Group by (store, normalized product name family) and flag where ≥2
    // products share the same verified price.
    const familyGroups = new Map<string, Product[]>();
    for (const p of recent) {
        const family = `${p.store}|${(p.name ?? '').replace(/\|.*/, '').replace(/\s*\d+(g|kg|stuks)\s*$/i, '').trim().toLowerCase()}`;
        if (!familyGroups.has(family)) familyGroups.set(family, []);
        familyGroups.get(family)!.push(p);
    }
    const alreadyFlagged = new Set(suspects.map((s) => s.product.id));
    for (const [family, prods] of familyGroups) {
        if (prods.length < 2) continue;
        // Group within family by identical verified price
        const priceMap = new Map<string, Product[]>();
        for (const p of prods) {
            const key = (p.ai_verified_price ?? 0).toFixed(2);
            if (!priceMap.has(key)) priceMap.set(key, []);
            priceMap.get(key)!.push(p);
        }
        for (const [priceStr, sharedProds] of priceMap) {
            if (sharedProds.length < 2) continue;
            // Multiple variants of same family got identical verified price → AI saw the default.
            // BUT only worth flagging if at least one variant's price actually changed during
            // this verification run. Otherwise it's a pre-existing data quality issue that
            // verify-with-ai didn't introduce.
            const changedAny = sharedProds.some((p) => {
                const live = p.price ?? 0;
                const verified = p.ai_verified_price ?? 0;
                return live > 0 && Math.abs(live - verified) / Math.max(live, verified) > 0.01;
            });
            if (!changedAny) continue;
            for (const p of sharedProds) {
                if (alreadyFlagged.has(p.id)) continue;
                suspects.push({
                    product: p,
                    reason: `cluster: ${sharedProds.length} variants of "${family.split('|')[1]}" all share €${priceStr}`,
                    livePrice: p.price ?? 0,
                    verifiedPrice: p.ai_verified_price!,
                    changePct: 0,
                    direction: 'cluster',
                });
                alreadyFlagged.add(p.id);
            }
        }
    }

    console.log(`${suspects.length} suspicious cases flagged`);

    // ── Write markdown ──
    const lines: string[] = [];
    lines.push('# Suspicious Price Syncs — Manual Spot-Check');
    lines.push('');
    lines.push(`_Generated ${new Date().toISOString()} — ${suspects.length} cases where today's AI verification produced a questionable price change._`);
    lines.push('');
    lines.push('**Heuristics flagged:**');
    lines.push(`- 🔻 Big drop: new price < ${100 - BIG_DROP_PCT}% of old (likely AI picked wrong variant on a multi-size page)`);
    lines.push(`- 🔺 Big rise: new price > ${BIG_INCREASE_PCT}% of old (possibly amount-unit mismatch)`);
    lines.push(`- 🎯 Cluster: multiple variants of the same product family ended up with identical AI-verified prices`);
    lines.push('');
    lines.push('For each: open the live URL, check the real price for the listed amount, then:');
    lines.push('');
    lines.push('- ✅ If AI was correct → leave it');
    lines.push('- 🔧 If AI was wrong → open dashboard edit link, restore correct price (and consider setting `manual_lock=true` to prevent future overrides)');
    lines.push('');

    // Group by shop
    const byStore = new Map<string, Suspect[]>();
    for (const s of suspects) {
        const k = s.product.store ?? '(no store)';
        if (!byStore.has(k)) byStore.set(k, []);
        byStore.get(k)!.push(s);
    }
    const stores = Array.from(byStore.entries()).sort((a, b) => b[1].length - a[1].length);

    for (const [storeName, items] of stores) {
        lines.push(`## ${storeName} (${items.length})`);
        lines.push('');
        for (const s of items.sort((a, b) => (a.product.name ?? '').localeCompare(b.product.name ?? ''))) {
            const p = s.product;
            const icon = s.direction === 'drop' ? '🔻' : s.direction === 'rise' ? '🔺' : '🎯';
            lines.push(`- ${icon} [ ] **${p.name}** — ${p.amount}g`);
            lines.push(`  - Was: €${s.livePrice.toFixed(2)} → Now: **€${s.verifiedPrice.toFixed(2)}**  (${s.reason})`);
            lines.push(`  - Live: ${p.url ?? '(no url)'}`);
            lines.push(`  - Edit: ${DASHBOARD}${p.id}`);
        }
        lines.push('');
    }

    await writeFile(outPath, lines.join('\n'), 'utf-8');
    console.log(`Wrote suspicious list to ${outPath}`);

    console.log('\nPer-shop summary:');
    for (const [storeName, items] of stores) {
        console.log(`  ${String(items.length).padStart(3)} ${storeName}`);
    }
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Failed:', err);
    process.exit(1);
});
