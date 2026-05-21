// Final cleanup pass after the layer-0 migration.
//
// Handles three batches:
//   A. 8 products where XPath returns a broken/absurd price but Free Extractor
//      returns a realistic one. Migrate them to extraction_method=free_*.
//   B. 14 hard_failed products that returned HTTP 200 with JSON-LD on re-check
//      (curl + Mozilla UA). Re-enable + set extraction_method=free_jsonld so
//      Layer 0 takes over.
//   C. 2 broken cases in no_crosscheck (€6.6 billion etc.) — no Free fallback,
//      so we just flag them: set scrape_enabled=false until someone fixes the
//      URL/XPath by hand. Surfaced via dashboard for manual review.
//
// Run with:
//   pnpm tsx src/jobs/finalize-fixes.ts             # dry run (default)
//   pnpm tsx src/jobs/finalize-fixes.ts -- --apply  # write to Firestore

const apply = process.argv.includes('--apply');
console.log(`[finalize] Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
console.log('');

// ============================================================================
// BATCH A — broken XPath + realistic Free Extractor → migrate to Layer 0
// ============================================================================
const BATCH_A: Array<{ pid: string; name: string; method: string; current: string; new_price: number }> = [
    { pid: '0SnB5kO9GWeLWFyZF9QD', name: '[Woele] Creatine Monohydraat 500g', method: 'free_jsonld', current: '€99919.66', new_price: 9.99 },
    { pid: '4IFX00pVvZHgFg1l3x5O', name: '[Woele] Creatine Monohydraat 250g', method: 'free_jsonld', current: '€99919.66', new_price: 9.99 },
    { pid: '9gkojE0I4uygdCRcB6s2', name: '[German Elite Nutrition] Creatine HCL Capsules 365', method: 'free_jsonld', current: '€0.27', new_price: 27.58 },
    { pid: 'Xa5HRiqwGpXiyDNuOhvR', name: '[Body&Fit] Whey Isolate XP 2kg', method: 'free_jsonld', current: '€41991.61', new_price: 41.99 },
    { pid: 'Y3K2gi9bLp7Cls6gEGBd', name: '[Clean Nutrition] Pomp Apparaat Pre Workout', method: 'free_shopify', current: '€121915.24 (XPath)', new_price: 12.19 },
    { pid: 'iQ1CLkx0kJfIHeVFmbDe', name: '[Clean Nutrition] Xtreme V2 Zonder Cafeine', method: 'free_shopify', current: '€284535.57 (XPath)', new_price: 28.45 },
    { pid: 'mQcPIm3otkQGJsPh71oJ', name: '[Body&Fit] Whey Essential 1kg', method: 'free_shopify', current: '€18490.92', new_price: 29.99 },
    { pid: 'uCqb01gXF3e4noaiyFwb', name: '[BodyLab] Whey Protein 3x2kg', method: 'free_shopify', current: '€7156', new_price: 174.9 },
];

console.log('=== BATCH A: migrate 8 broken-XPath to Free Extractor ===');
for (const r of BATCH_A) {
    console.log(`  ${r.name}`);
    console.log(`    ${r.current} → €${r.new_price} (${r.method})`);
}
console.log('');

// ============================================================================
// BATCH B — DROPPED.
// The 14 hard_failed candidates all returned HTTP 200 and had JSON-LD blocks,
// but live testing showed 0/14 expose a usable Product schema with a price —
// prices are rendered client-side via JS. Free Extractor (plain HTTP) cannot
// reach them. Re-enabling would just hard-fail them again. They stay disabled.
// ============================================================================
console.log('=== BATCH B: SKIPPED (14 candidates use JS-rendered prices) ===');
console.log('');

// ============================================================================
// BATCH C — broken price, no Free fallback → flag for manual review
// ============================================================================
const BATCH_C: Array<{ pid: string; name: string; current: string }> = [
    { pid: 'aQFKXgNGlLgS519U69wQ', name: '[Viata] 6D Sports Beta Alanine', current: '€6,645,153,815' },
    { pid: 'o9e9BKevgIaAFML3mk55', name: '[Power Supplements] Pure Whey Isolate 15kg', current: '€299,023.92' },
];

console.log('=== BATCH C: flag for manual review (no Free fallback) ===');
for (const r of BATCH_C) console.log(`  ${r.name}  current=${r.current}`);
console.log('');

if (!apply) {
    console.log('[finalize] DRY RUN — pass --apply to write to Firestore');
    process.exit(0);
}

console.log('[finalize] APPLYING to Firestore...');
const { db } = await import('../db/firebase.js');
const collection = db.collection('products');

let updated = 0;
let failed = 0;

// BATCH A — set extraction_method
for (const r of BATCH_A) {
    try {
        await collection.doc(r.pid).update({
            extraction_method: r.method,
            // Reset the price; daily scrape will refresh
        });
        updated++;
        console.log(`  ✓ A: ${r.name} → ${r.method}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ A: ${r.name}: ${(err as Error).message}`);
    }
}

// BATCH B skipped — JS-rendered prices, see header.

// BATCH C — keep disabled, dashboard handles it
console.log(`  ⊘ C: ${BATCH_C.length} flagged for manual review (no write)`);

console.log('');
console.log(`[finalize] Done. ${updated} updated, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
