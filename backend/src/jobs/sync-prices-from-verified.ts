/**
 * One-shot sync: for every product where `ai_verified_at` is set and the
 * stored `price` differs from `ai_verified_price`, copy ai_verified_price → price.
 *
 * Why this exists: between 2026-05-20 and a later iteration of verify-with-ai,
 * the `stamp_verified` / `override_selector` / `flag_warning` write paths
 * forgot to update the `price` field. Products were left with stale price but
 * correct ai_verified_price. This job heals that.
 *
 * Reusable: any future divergence between price and ai_verified_price can be
 * resolved by running this. AI is treated as source of truth.
 *
 * Usage:
 *   pnpm tsx src/jobs/sync-prices-from-verified.ts                # dry run
 *   pnpm tsx src/jobs/sync-prices-from-verified.ts -- --apply     # write to Firestore
 *   pnpm tsx src/jobs/sync-prices-from-verified.ts -- --apply --max-age-days 1
 *
 * Options:
 *   --max-age-days N  Only sync products whose ai_verified_at is within N days (default: 7)
 *   --tolerance-pct N Only sync if difference > N% (default 1; skip near-identical)
 */
import 'dotenv/config';
import { db } from '../db/firebase.js';
import type { Product } from '@eiwittens/types';

interface CliOptions {
    apply: boolean;
    maxAgeDays: number;
    tolerancePct: number;
}

function parseArgs(args: string[]): CliOptions {
    const opts: CliOptions = { apply: false, maxAgeDays: 7, tolerancePct: 1 };
    for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (a === '--' || a === '') continue;
        else if (a === '--apply') opts.apply = true;
        else if (a === '--max-age-days') opts.maxAgeDays = Number.parseInt(args[++i] ?? '', 10);
        else if (a.startsWith('--max-age-days=')) opts.maxAgeDays = Number.parseInt(a.slice('--max-age-days='.length), 10);
        else if (a === '--tolerance-pct') opts.tolerancePct = Number.parseFloat(args[++i] ?? '');
        else if (a.startsWith('--tolerance-pct=')) opts.tolerancePct = Number.parseFloat(a.slice('--tolerance-pct='.length));
        else throw new Error(`Unknown argument: ${a}`);
    }
    return opts;
}

function toDate(value: Product['ai_verified_at']): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && 'seconds' in value) return new Date(value.seconds * 1000);
    return null;
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    console.log(`[sync-prices] Mode: ${opts.apply ? 'APPLY' : 'DRY RUN'} (max age ${opts.maxAgeDays}d, tolerance ${opts.tolerancePct}%)`);

    const snap = await db.collection('products').get();
    const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) })) as Product[];

    const cutoffMs = Date.now() - opts.maxAgeDays * 24 * 60 * 60 * 1000;
    const candidates = all.filter((p) => {
        const dt = toDate(p.ai_verified_at);
        if (!dt) return false;
        if (dt.getTime() < cutoffMs) return false;
        if (typeof p.ai_verified_price !== 'number') return false;
        return true;
    });
    console.log(`[sync-prices] ${candidates.length} products have a fresh ai_verified_price (within ${opts.maxAgeDays}d)`);

    const toSync: Product[] = [];
    const blocked: Product[] = [];
    for (const p of candidates) {
        const live = typeof p.price === 'number' ? p.price : 0;
        const verified = p.ai_verified_price!;
        const diffPct = verified > 0 ? (Math.abs(live - verified) / verified) * 100 : Number.POSITIVE_INFINITY;
        if (diffPct <= opts.tolerancePct) continue;

        // Safety net for AI per-unit-price bugs (e.g. Zumub microdata gives €/gram).
        // If the verified price is suspiciously low AND we already had a plausible
        // price, treat it as a hallucination and refuse the sync. The current price
        // stays. The product can still be reviewed manually.
        if (verified < 3 && live > 5) {
            blocked.push(p);
            continue;
        }
        toSync.push(p);
    }
    console.log(`[sync-prices] ${toSync.length} have price drift > ${opts.tolerancePct}% and will be synced`);
    if (blocked.length > 0) {
        console.log(`[sync-prices] ${blocked.length} suspicious drops blocked (verified <€3 while live >€5):`);
        for (const p of blocked) {
            console.log(`    ⚠ ${p.id}  ${p.store} — ${p.name}  €${p.price?.toFixed(2)} → €${p.ai_verified_price?.toFixed(2)} (likely per-unit bug, kept original)`);
        }
    }
    console.log('');

    let synced = 0;
    let errors = 0;

    for (const p of toSync.sort((a, b) => (a.store ?? '').localeCompare(b.store ?? ''))) {
        const live = typeof p.price === 'number' ? p.price : 0;
        const verified = p.ai_verified_price!;
        const diffPct = (Math.abs(live - verified) / verified) * 100;
        console.log(`  ${opts.apply ? '✓' : '↻'} ${p.id}  ${(p.store ?? '').padEnd(20)} ${p.name?.slice(0, 50).padEnd(50)} €${live.toFixed(2).padStart(7)} → €${verified.toFixed(2).padStart(7)}  (Δ ${diffPct.toFixed(1)}%)`);
        if (opts.apply) {
            try {
                await db.collection('products').doc(p.id).update({ price: verified });
                synced += 1;
            } catch (err) {
                errors += 1;
                console.error(`    ERROR: ${(err as Error).message}`);
            }
        }
    }

    console.log('');
    console.log(`[sync-prices] ${opts.apply ? `Done. synced=${synced} errors=${errors}` : 'DRY RUN — pass --apply to write'}`);
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Sync failed:', err);
    process.exit(1);
});
