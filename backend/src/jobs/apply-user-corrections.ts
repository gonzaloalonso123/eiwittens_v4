// Apply Timo's manual corrections from MANUAL-REVIEW.md to Firestore.
//
// Each correction is matched by (store, name_substring, optional amount) → productId.
// Actions: update_amount, update_url, update_amount_and_url, delete, keep_as_is.
//
// `delete` = disable (sets enabled=false, scrape_enabled=false). We don't hard-delete
// from Firestore so the product can be re-enabled later if it returns.
//
// Run with:
//   pnpm tsx src/jobs/apply-user-corrections.ts             # dry run, no writes
//   pnpm tsx src/jobs/apply-user-corrections.ts -- --apply  # write to Firestore

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_API = 'https://eiwittens-backend-16129604687.europe-west4.run.app';
const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'corrections-applied');

type Action = 'update_amount' | 'update_url' | 'update_amount_and_url' | 'delete' | 'keep_as_is';

interface Correction {
    store: string;
    name_contains: string;
    amount_match?: number; // grams; if provided must match GG's amount
    action: Action;
    new_amount?: number;
    new_url?: string;
    new_store?: string; // optional: also rename the product's store
    reason: string;
    apply_to_all_matches?: boolean; // if true, action applied to every matching product
}

// ── User's corrections (from MANUAL-REVIEW.md review on 2026-05-19) ──────────

const CORRECTIONS: Correction[] = [
    // ── Section 2: medium amount updates (after manual verify) ──
    { store: 'Woele', name_contains: 'Creatine Monohydraat', amount_match: 250, action: 'update_amount_and_url', new_amount: 500, new_url: 'https://woele.nl/product/creatine-monohydraat-poeder-500g/', reason: '250g not sold; 500g is current product' },
    { store: 'ESN', name_contains: 'Massive Weight Gainer', amount_match: 4000, action: 'delete', reason: 'Product no longer exists' },
    { store: 'Virtuoos', name_contains: 'Beta Alanine Gold', action: 'keep_as_is', reason: '90 caps × 750mg = 67.5g, GG correct' },
    { store: 'Vitaminesperpost.nl', name_contains: 'Bèta Alanine', action: 'keep_as_is', reason: '100 caps × 500mg = 50g, GG correct' },
    { store: 'UPFRONT', name_contains: 'Whey Isolaat', action: 'keep_as_is', reason: '700g is correct, shown at page bottom' },
    { store: 'Woele', name_contains: 'Taurine', amount_match: 250, action: 'update_amount_and_url', new_amount: 500, new_url: 'https://woele.nl/product/taurine-poeder-500g/', reason: '250g discontinued; 500g current' },
    { store: 'UPFRONT', name_contains: 'Eiwit Kokoswater', action: 'keep_as_is', reason: '700g correct, shown at page bottom' },
    { store: 'Sunday', name_contains: 'Creatine Monohydraat', amount_match: 500, action: 'delete', reason: 'Product no longer exists' },
    { store: 'MyProtein', name_contains: 'Impact Whey Isolate', amount_match: 500, action: 'update_amount_and_url', new_amount: 450, new_url: 'https://nl.myprotein.com/p/sports-nutrition/impact-whey-isolate/10530911/?variation=17716556', reason: '450g is the actual variant size' },
    { store: 'De Gezonde Wereld', name_contains: 'Cooling Herbs', action: 'delete', reason: 'Planet Paleo Bone Broth Cooling Herbs no longer exists' },
    { store: 'Sportvoedingmaken', name_contains: 'WHEY Protein 80 Bio', amount_match: 20000, action: 'update_amount_and_url', new_amount: 15000, new_url: 'https://www.sportvoedingmaken.nl/product/18359490/organic-whey-protein-80-bio-whey-concentraat-grootverpakking-15-kg', reason: '20kg no longer sold; 15kg is current bulk pack' },

    // ── Section 3: refresh_url (2 confirmed correct) ──
    { store: 'Pure.', name_contains: 'Go Hard Pre Workout', action: 'update_url', new_url: 'https://www.body-supplies.nl/pre-workout-go-pumped-powder-pure', reason: 'Confirmed correct refresh' },
    { store: 'Pure.', name_contains: 'Go Hard Xtreme Pre Workout', action: 'update_url', new_url: 'https://www.body-supplies.nl/pre-workout-go-pumped-powder-pure', reason: 'Confirmed correct refresh' },

    // ── Section 4: body-supplies.nl URL refreshes (all manually verified) ──
    { store: 'Mutant', name_contains: 'Caffeine Tablets', action: 'update_url', new_url: 'https://www.body-supplies.nl/supplement-caffeine-core-serie-mutant', reason: 'body-supplies URL refresh' },
    { store: 'Olimp', name_contains: 'Citrulline Malate', amount_match: 200, action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-citrulline-malate-olimp', reason: 'body-supplies URL refresh' },
    { store: 'Applied Nutrition', name_contains: 'Taurine', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-taurine-powder-applied-nutrition', reason: 'body-supplies URL refresh' },
    { store: 'Jarrow Formulas', name_contains: 'Taurine Capsules', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-taurine-1000-jarrow-formulas', reason: 'body-supplies URL refresh' },
    { store: 'EFXSport', name_contains: 'Kre-Alkalyn Original Capsules | 120 stuks', action: 'update_url', new_url: 'https://www.body-supplies.nl/creatine-kre-alkalyn-all-american-efx', reason: 'body-supplies URL refresh — 120 stuks (90g)' },
    { store: 'Stacker2', name_contains: '6th Gear Creatine', action: 'update_url', new_url: 'https://www.body-supplies.nl/6th-gear-creatine-monohydraat-stacker2', reason: 'body-supplies URL refresh' },
    { store: 'BodySupplies', name_contains: 'Pure Xtreme Mass Gainer', action: 'update_url', new_url: 'https://www.body-supplies.nl/eiwitpoeder-xtreme-mass-gainer-pure', new_store: 'Pure.', reason: 'URL refresh + rebrand to Pure. (was misfiled under BodySupplies)' },
    { store: 'Haya Labs', name_contains: 'Sports Citrulline Malate', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-sports-citrulline-malate-haya-labs', reason: 'body-supplies URL refresh' },
    { store: 'BodySupplies', name_contains: 'Pure Creatine Micronized', amount_match: 250, action: 'update_url', new_url: 'https://www.body-supplies.nl/creatine-monohydraat-micronized-pure', new_store: 'Pure.', reason: 'URL refresh + rebrand to Pure.' },
    { store: 'Rich Piana', name_contains: 'Crea-TEN', action: 'update_url', new_url: 'https://www.body-supplies.nl/creatine-crea-ten-rich-piana', reason: 'body-supplies URL refresh' },
    { store: 'BodySupplies', name_contains: 'Isolate Whey Pro', action: 'delete', reason: 'Product no longer exists (all variants)', apply_to_all_matches: true },
    { store: 'AppliedNutrition', name_contains: 'Pump Pre Workout 3G', action: 'update_url', new_url: 'https://www.body-supplies.nl/pre-workout-pump-3g-applied-nutrition', reason: 'body-supplies URL refresh', apply_to_all_matches: true },
    { store: 'UniversalNutrition', name_contains: 'Animal Fury', action: 'update_url', new_url: 'https://www.body-supplies.nl/pre-workout-animal-fury-universal-nutrition', reason: 'body-supplies URL refresh', apply_to_all_matches: true },
    { store: 'EFXSport', name_contains: 'Poeder', amount_match: 110, action: 'delete', reason: 'Kre-Alkalyn EFX Poeder 110g discontinued' },
    { store: 'EFXSport', name_contains: 'Poeder', amount_match: 220, action: 'update_url', new_url: 'https://www.body-supplies.nl/creatine-kre-alkalyn-all-american-efx', reason: 'body-supplies URL refresh' },
    { store: 'Olimp', name_contains: 'Beta-Alanine Carno', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-beta-alanine-carno-rush-olimp', reason: 'body-supplies URL refresh' },
    { store: 'BodySupplies', name_contains: 'Pure Creatine Micronized', amount_match: 500, action: 'update_url', new_url: 'https://www.body-supplies.nl/creatine-monohydraat-micronized-pure', new_store: 'Pure.', reason: 'URL refresh + rebrand to Pure.' },
    { store: 'BodySupplies', name_contains: 'AP Clear Beef Protein Isolate', action: 'delete', reason: 'Product no longer exists' },
    { store: 'Now Foods', name_contains: 'Beta Alanine', amount_match: 90, action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-beta-alanine-now-foods', reason: 'body-supplies URL refresh — capsules variant' },
    { store: 'DedicatedNutrition', name_contains: 'Unstoppable Pump', action: 'update_url', new_url: 'https://www.body-supplies.nl/pre-workout-unstoppable-pump-dedicated-nutrition', reason: 'body-supplies URL refresh' },
    { store: 'Purasana', name_contains: 'Vegan Protein Pompoen', action: 'delete', reason: 'Product no longer exists (already flagged earlier)' },
    { store: 'Stacker2', name_contains: 'Alpha Male', action: 'update_url', new_url: 'https://www.body-supplies.nl/pre-workout-alpha-male-stacker', reason: 'body-supplies URL refresh' },
    { store: 'Stacker2', name_contains: 'Complete Creatine', action: 'update_url', new_url: 'https://www.body-supplies.nl/complete-creatine-monohydraat-stacker2', reason: 'body-supplies URL refresh' },
    { store: 'BodySupplies', name_contains: 'Pure Vegan Protein', action: 'update_url', new_url: 'https://www.body-supplies.nl/eiwitpoeder-vegan-protein-shake-pure', new_store: 'Pure.', reason: 'URL refresh + rebrand to Pure. (all variants)', apply_to_all_matches: true },
    { store: 'Haya Labs', name_contains: 'Beta-Alanine', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-sports-beta-alanine-haya-labs', reason: 'body-supplies URL refresh' },
    { store: 'Now Foods', name_contains: 'Beta-Alanine Powder', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-beta-alanine-powder-now-foods', reason: 'body-supplies URL refresh — powder variant' },
    { store: 'AK47', name_contains: 'Schizo', action: 'update_url', new_url: 'http://body-supplies.nl/pre-workout-ak-47-schizo-ak-47-labs', reason: 'body-supplies URL refresh' },
    { store: 'Applied Nutrition', name_contains: 'Beta-Alanine', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-beta-alanine-powder-applied-nutrition', reason: 'body-supplies URL refresh' },
    { store: 'Haya Labs', name_contains: 'Taurine Capsules', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-sports-taurine-haya-labs', reason: 'body-supplies URL refresh' },
    { store: 'BodySupplies', name_contains: 'Hydro Whey |', action: 'update_url', new_url: 'https://www.body-supplies.nl/eiwitpoeder-hydro-whey-pro-pure', new_store: 'Pure.', reason: 'URL refresh + rebrand to Pure. (both 750g and 2kg variants)', apply_to_all_matches: true },
    { store: 'Pure.', name_contains: 'Go Pumped Powder', action: 'update_url', new_url: 'https://www.body-supplies.nl/pre-workout-go-pumped-powder-pure', reason: 'body-supplies URL refresh' },
    { store: 'BodySupplies', name_contains: 'Mutant Madness', action: 'delete', reason: 'Mutant Madness All In One no longer exists (sold under BodySupplies store)' },
    { store: 'Olimp', name_contains: 'Redweiler', action: 'update_url', new_url: 'https://www.body-supplies.nl/pre-workout-redweiler-focus-olimp', reason: 'body-supplies URL refresh — Redweiler Focus' },
    { store: 'EFXSport', name_contains: 'Kre-Alkalyn Hardcore', action: 'update_url', new_url: 'https://www.body-supplies.nl/creatine-kre-alkalyn-hardcore-all-american-efx', reason: 'body-supplies URL refresh' },
    { store: 'Olimp', name_contains: 'Pump Express', action: 'update_url', new_url: 'https://www.body-supplies.nl/pre-workout-pump-express-20-olimp', reason: 'body-supplies URL refresh' },
    { store: 'BodySupplies', name_contains: 'Pure Beef Protein', action: 'update_url', new_url: 'https://www.body-supplies.nl/eiwitpoeder-beef-protein-pure', new_store: 'Pure.', reason: 'URL refresh + rebrand to Pure. (all variants)', apply_to_all_matches: true },
    { store: 'Rich Piana', name_contains: 'L-Citrulline', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-l-citrulline-3000-core-series-5-nutrition', reason: 'body-supplies URL refresh' },
    { store: 'Mammut', name_contains: 'Beta Alanine Powder', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-beta-alanine-powder-mammut', reason: 'body-supplies URL refresh' },
    { store: 'Now Foods', name_contains: 'L-Tyrosine Capsules', amount_match: 60, action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-l-tyrosine-500mg-now-foods', reason: 'body-supplies URL refresh (120 stuks variant)' },
    { store: 'ProSupps', name_contains: 'Dr. Jekyll', action: 'update_url', new_url: 'https://www.body-supplies.nl/pre-workout-drjekyll-signature-prosupps', reason: 'body-supplies URL refresh' },
    { store: 'Pure.', name_contains: 'L-Tyrosine', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-l-tyrosine-500mg-pure', reason: 'body-supplies URL refresh' },
    { store: 'Pure.', name_contains: 'Beta Alanine', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-beta-alanine-500mg-pure', reason: 'body-supplies URL refresh' },
    { store: 'EFXSport', name_contains: 'Kre-Alkalyn Original Capsules | 240 stuks', action: 'update_url', new_url: 'https://www.body-supplies.nl/creatine-kre-alkalyn-all-american-efx', reason: 'body-supplies URL refresh — 240 stuks (180g)' },
    { store: 'AK47', name_contains: 'Pump Pre Workout', action: 'update_url', new_url: 'https://www.body-supplies.nl/pre-workout-ak-47-pump-ak-47-labs', reason: 'body-supplies URL refresh' },
    { store: 'BodySupplies', name_contains: 'ON Hydro Whey', action: 'update_url', new_url: 'https://www.body-supplies.nl/eiwitpoeder-platinum-hydro-whey-optimum', reason: 'body-supplies URL refresh' },
    { store: 'Applied Nutrition', name_contains: 'Beta-Alanine', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-beta-alanine-1500-applied-nutrition', reason: 'body-supplies URL refresh — 180g' },
    { store: 'Now Foods', name_contains: 'Taurine Capsules', action: 'update_url', new_url: 'https://www.body-supplies.nl/aminozuren-taurine-now-foods', reason: 'body-supplies URL refresh (all variants)', apply_to_all_matches: true },
    { store: 'BodySupplies', name_contains: 'Supreme Whey', action: 'update_url', new_url: 'https://www.body-supplies.nl/eiwitpoeder-supreme-whey-pure', new_store: 'Pure.', reason: 'URL refresh + rebrand to Pure.' },
];

// ── Section 1 — auto-apply HIGH-confidence amount fixes from auto-fix v4 ──
// These are exact-match or <25% drift size fixes that don't need review.
const SECTION_1_HIGH_CONF_FIXES_FROM_AUTOFIX = true; // read from latest auto-fix JSON

// ── Implementation ──────────────────────────────────────────────────────────

interface GgProduct {
    id: string;
    name: string;
    store: string;
    url: string;
    amount?: number;
    enabled: boolean;
    scrape_enabled: boolean;
}

function matchProduct(c: Correction, products: GgProduct[]): GgProduct[] {
    return products.filter((p) => {
        const storeMatches = p.store.trim().toLowerCase() === c.store.trim().toLowerCase();
        if (!storeMatches) return false;
        const nameLow = p.name.toLowerCase();
        if (!nameLow.includes(c.name_contains.toLowerCase())) return false;
        if (c.amount_match !== undefined && c.amount_match > 0) {
            if (p.amount !== c.amount_match) return false;
        }
        return true;
    });
}

const apply = process.argv.includes('--apply');
console.log(`[corrections] Mode: ${apply ? 'APPLY (writes to Firestore!)' : 'DRY RUN'}`);

// Load all products from public API
console.log('[corrections] Loading products...');
const products = await fetch(`${BACKEND_API}/products?type=MINIMAL`).then((r) => r.json()) as GgProduct[];
console.log(`[corrections] Loaded ${products.length} products`);

// Resolve each correction to product matches
interface ResolvedCorrection extends Correction {
    matched: GgProduct[];
    status: 'matched' | 'no_match' | 'ambiguous';
}

const resolved: ResolvedCorrection[] = CORRECTIONS.map((c) => {
    const matched = matchProduct(c, products);
    let status: ResolvedCorrection['status'];
    if (matched.length === 0) status = 'no_match';
    else if (matched.length === 1) status = 'matched';
    else if (c.apply_to_all_matches) status = 'matched'; // treat as matched, will apply to all
    else status = 'ambiguous';
    return { ...c, matched, status };
});

// Also add the HIGH-CONFIDENCE auto-fix amount updates, but skip no-ops where
// new_amount === current_amount (DQ audit false positives caused by string-match
// of "700g" not matching the page's "700gram" — the auto-fix returned the same value).
if (SECTION_1_HIGH_CONF_FIXES_FROM_AUTOFIX) {
    try {
        const { readdir, readFile } = await import('node:fs/promises');
        const fixDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'auto-fix-reports');
        const files = (await readdir(fixDir)).filter((f) => f.endsWith('.json')).sort();
        if (files.length > 0) {
            const latest = JSON.parse(await readFile(resolve(fixDir, files[files.length - 1]), 'utf-8')) as Array<{
                productId: string; store: string; name: string; current_amount?: number;
                action: string; new_amount?: number; confidence: string;
            }>;
            const highConfRaw = latest.filter((f) => f.action === 'update_amount' && f.confidence === 'high');
            const highConf = highConfRaw.filter((f) => f.new_amount !== f.current_amount);
            const skipped = highConfRaw.length - highConf.length;
            console.log(`[corrections] Auto-fix Section 1: ${highConfRaw.length} raw, ${skipped} no-ops skipped, ${highConf.length} actual updates`);
            for (const f of highConf) {
                const product = products.find((p) => p.id === f.productId);
                if (!product) continue;
                resolved.push({
                    store: f.store,
                    name_contains: f.name,
                    action: 'update_amount',
                    new_amount: f.new_amount!,
                    reason: `auto-fix HIGH confidence (${f.current_amount}g → ${f.new_amount}g)`,
                    matched: [product],
                    status: 'matched',
                });
            }
        }
    } catch (e) {
        console.warn(`[corrections] Could not load auto-fix Section 1 fixes: ${(e as Error).message}`);
    }
}

// Build report
const summary: Record<string, number> = {};
const lines: string[] = [];
lines.push('# Migration Plan — User Corrections');
lines.push('');
lines.push(`*Generated: ${new Date().toISOString()}*`);
lines.push(`*Mode: ${apply ? 'APPLY' : 'DRY RUN'}*`);
lines.push('');

console.log('');
console.log('=== RESOLUTION SUMMARY ===');
for (const r of resolved) {
    summary[r.status] = (summary[r.status] ?? 0) + 1;
    if (r.status === 'no_match') {
        console.log(`  ✗ NO MATCH: ${r.store} | ${r.name_contains}${r.amount_match ? ` (amt=${r.amount_match})` : ''} | reason: ${r.reason}`);
    } else if (r.status === 'ambiguous') {
        console.log(`  ? AMBIGUOUS (${r.matched.length} matches): ${r.store} | ${r.name_contains}`);
        for (const m of r.matched) {
            console.log(`      - ${m.name} (amount=${m.amount}g, id=${m.id})`);
        }
    }
}
console.log('');
for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
console.log('');

// Build action plan
interface PlannedAction {
    productId: string;
    productName: string;
    store: string;
    action: Action;
    update: Record<string, unknown>;
    reason: string;
}

const planned: PlannedAction[] = [];
for (const r of resolved) {
    if (r.status !== 'matched') continue;
    if (r.action === 'keep_as_is') continue;
    const targets = r.apply_to_all_matches ? r.matched : [r.matched[0]];
    for (const p of targets) {
        if (r.action === 'delete') {
            planned.push({
                productId: p.id, productName: p.name, store: p.store, action: r.action,
                update: { enabled: false, scrape_enabled: false, out_of_stock: true },
                reason: r.reason,
            });
        } else if (r.action === 'update_amount') {
            planned.push({
                productId: p.id, productName: p.name, store: p.store, action: r.action,
                update: { amount: r.new_amount },
                reason: r.reason,
            });
        } else if (r.action === 'update_url') {
            const upd: Record<string, unknown> = { url: r.new_url };
            if (r.new_store) upd.store = r.new_store;
            planned.push({
                productId: p.id, productName: p.name, store: p.store, action: r.action,
                update: upd,
                reason: r.reason,
            });
        } else if (r.action === 'update_amount_and_url') {
            const upd: Record<string, unknown> = { amount: r.new_amount, url: r.new_url };
            if (r.new_store) upd.store = r.new_store;
            planned.push({
                productId: p.id, productName: p.name, store: p.store, action: r.action,
                update: upd,
                reason: r.reason,
            });
        }
    }
}

console.log('=== PLANNED ACTIONS ===');
const byAction: Record<string, PlannedAction[]> = {};
for (const a of planned) (byAction[a.action] ??= []).push(a);
for (const [act, items] of Object.entries(byAction)) {
    console.log(`  ${act}: ${items.length}`);
}
console.log(`  TOTAL: ${planned.length}`);
console.log('');

await mkdir(REPORT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(resolve(REPORT_DIR, `plan-${ts}.json`), JSON.stringify({ planned, resolved }, null, 2));

lines.push('## Summary');
lines.push('');
lines.push(`- Corrections defined: ${CORRECTIONS.length}`);
lines.push(`- Resolved with single match: ${summary.matched ?? 0}`);
lines.push(`- No match (skipped): ${summary.no_match ?? 0}`);
lines.push(`- Ambiguous (skipped): ${summary.ambiguous ?? 0}`);
lines.push(`- Auto-fix Section 1 added: ${planned.length - (summary.matched ?? 0)}`);
lines.push(`- Planned writes: ${planned.length}`);
lines.push('');
for (const [act, items] of Object.entries(byAction)) {
    lines.push(`### ${act} (${items.length})`);
    lines.push('');
    lines.push('| Store | Product | Update | Reason |');
    lines.push('|---|---|---|---|');
    for (const a of items) {
        lines.push(`| ${a.store} | ${a.productName.slice(0, 50)} | ${JSON.stringify(a.update).slice(0, 80)} | ${a.reason.slice(0, 60)} |`);
    }
    lines.push('');
}
await writeFile(resolve(REPORT_DIR, `plan-${ts}.md`), lines.join('\n'));
console.log(`[corrections] Plan written: ${resolve(REPORT_DIR, `plan-${ts}.md`)}`);

if (!apply) {
    console.log('');
    console.log('[corrections] DRY RUN complete. Add --apply to write to Firestore.');
    process.exit(0);
}

// Apply
console.log('');
console.log(`[corrections] APPLYING ${planned.length} updates to Firestore...`);
const { db } = await import('../db/firebase.js');
const collection = db.collection('products');

let succeeded = 0;
let failed = 0;
for (const a of planned) {
    try {
        await collection.doc(a.productId).update(a.update);
        succeeded++;
        console.log(`  ✓ ${a.action}: ${a.store} | ${a.productName.slice(0, 50)}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${a.productName}: ${(err as Error).message}`);
    }
}
console.log('');
console.log(`[corrections] Done. ${succeeded} succeeded, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
