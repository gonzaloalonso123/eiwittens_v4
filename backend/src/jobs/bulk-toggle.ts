/**
 * Bulk-set a single boolean field on a list of products. Reusable utility for
 * batch enable/disable operations (e.g. re-enabling a set of previously disabled
 * MyProtein products before running Awin --apply on them).
 *
 * Usage:
 *   pnpm tsx src/jobs/bulk-toggle.ts --field enabled --value true --ids id1,id2,id3
 *   pnpm tsx src/jobs/bulk-toggle.ts --field scrape_enabled --value false --ids id1,id2
 *   pnpm tsx src/jobs/bulk-toggle.ts ... --apply              # write to Firestore
 *
 * Without --apply, runs in dry-run mode and just prints what would change.
 *
 * Allowed fields: enabled, scrape_enabled, only_in_store, enabled_top10, manual_lock, warning, out_of_stock.
 */
import 'dotenv/config';
import { db } from '../db/firebase.js';
import type { Product } from '@eiwittens/types';

const ALLOWED_FIELDS = new Set([
    'enabled',
    'scrape_enabled',
    'only_in_store',
    'enabled_top10',
    'manual_lock',
    'warning',
    'out_of_stock',
]);

interface CliOptions {
    field?: string;
    value?: boolean;
    ids: string[];
    apply: boolean;
    help: boolean;
}

function parseArgs(args: string[]): CliOptions {
    const opts: CliOptions = { ids: [], apply: false, help: false };
    for (let i = 0; i < args.length; i += 1) {
        const a = args[i];
        if (a === '--' || a === '') continue;
        else if (a === '--help' || a === '-h') opts.help = true;
        else if (a === '--apply') opts.apply = true;
        else if (a === '--field') opts.field = args[++i];
        else if (a.startsWith('--field=')) opts.field = a.slice('--field='.length);
        else if (a === '--value') opts.value = args[++i] === 'true';
        else if (a.startsWith('--value=')) opts.value = a.slice('--value='.length) === 'true';
        else if (a === '--ids' || a === '--product-ids') opts.ids = (args[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        else if (a.startsWith('--ids=')) opts.ids = a.slice('--ids='.length).split(',').map((s) => s.trim()).filter(Boolean);
        else if (a.startsWith('--product-ids=')) opts.ids = a.slice('--product-ids='.length).split(',').map((s) => s.trim()).filter(Boolean);
        else throw new Error(`Unknown argument: ${a}`);
    }
    return opts;
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help || !opts.field || opts.value === undefined || opts.ids.length === 0) {
        console.log('Usage: pnpm tsx src/jobs/bulk-toggle.ts --field <name> --value <true|false> --ids <id1,id2,...> [--apply]');
        console.log(`Allowed fields: ${Array.from(ALLOWED_FIELDS).join(', ')}`);
        return;
    }
    if (!ALLOWED_FIELDS.has(opts.field)) {
        throw new Error(`Field ${opts.field} is not in allowed list: ${Array.from(ALLOWED_FIELDS).join(', ')}`);
    }

    console.log(`[bulk-toggle] Mode: ${opts.apply ? 'APPLY (writes)' : 'DRY RUN'}`);
    console.log(`[bulk-toggle] Setting ${opts.field}=${opts.value} on ${opts.ids.length} product(s)`);
    console.log('');

    const collection = db.collection('products');
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const id of opts.ids) {
        const ref = collection.doc(id);
        const snap = await ref.get();
        if (!snap.exists) {
            console.log(`  ✗ ${id}: NOT FOUND`);
            errors += 1;
            continue;
        }
        const p = snap.data() as Product;
        const current = (p as unknown as Record<string, boolean | undefined>)[opts.field];
        if (current === opts.value) {
            console.log(`  - ${id}  ${(p.store ?? '').padEnd(20)} ${p.name?.slice(0, 50)}  (already ${opts.field}=${opts.value})`);
            skipped += 1;
            continue;
        }
        console.log(`  ${opts.apply ? '✓' : '↻'} ${id}  ${(p.store ?? '').padEnd(20)} ${p.name?.slice(0, 50)}  ${opts.field}: ${current} → ${opts.value}`);
        if (opts.apply) {
            try {
                await ref.update({ [opts.field]: opts.value });
                updated += 1;
            } catch (err) {
                console.error(`    ERROR: ${(err as Error).message}`);
                errors += 1;
            }
        }
    }

    console.log('');
    console.log(`[bulk-toggle] Summary: ${updated} updated, ${skipped} unchanged, ${errors} errors`);
    if (!opts.apply) console.log('[bulk-toggle] DRY RUN — pass --apply to write to Firestore');
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Bulk-toggle failed:', err);
    process.exit(1);
});
