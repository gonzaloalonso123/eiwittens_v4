/**
 * Full inventory of the products collection. Read-only.
 *
 * Answers questions like:
 *   - How many total products?
 *   - How many are in the daily scrape pipeline vs. excluded?
 *   - How many have scrape_enabled=false (manually disabled with hard price)?
 *   - How many use Layer 0 (free_*) vs Layer 1 (playwright)?
 *   - How many have no scraper actions configured?
 *   - How many have manual_lock=true?
 *
 * Usage:
 *   pnpm tsx src/jobs/inventory-products.ts
 *   pnpm tsx src/jobs/inventory-products.ts --list-hard-priced
 *   pnpm tsx src/jobs/inventory-products.ts --list-no-scraper
 *   pnpm tsx src/jobs/inventory-products.ts --list-manual-lock
 */
import 'dotenv/config';
import { db } from '../db/firebase.js';
import type { Product } from '@eiwittens/types';
import { ActionType } from '@eiwittens/types';

interface Bucket {
    label: string;
    products: Product[];
}

function pct(n: number, total: number): string {
    if (total === 0) return '0%';
    return `${((n / total) * 100).toFixed(1)}%`;
}

function header(s: string): void {
    console.log(`\n=== ${s} ===\n`);
}

function bucketBy<K extends string>(products: Product[], keyFn: (p: Product) => K): Map<K, Product[]> {
    const m = new Map<K, Product[]>();
    for (const p of products) {
        const k = keyFn(p);
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(p);
    }
    return m;
}

function printDistribution(title: string, m: Map<string, Product[]>, total: number): void {
    console.log(`${title}:`);
    const entries = Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
    for (const [k, v] of entries) {
        console.log(`  ${k.padEnd(40)} ${String(v.length).padStart(4)} (${pct(v.length, total)})`);
    }
}

function hasSelectAction(p: Product): boolean {
    return Array.isArray(p.scraper) && p.scraper.some((a) => a.type === ActionType.Select);
}

async function main(): Promise<void> {
    const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));

    const snapshot = await db.collection('products').get();
    const all: Product[] = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }));

    header('TOTAL CATALOG');
    console.log(`Total products in Firestore: ${all.length}`);

    // ── Top-level toggles ────────────────────────────────────────────────────
    const enabled = all.filter((p) => p.enabled);
    const disabled = all.filter((p) => !p.enabled);
    const scrapeEnabled = enabled.filter((p) => p.scrape_enabled);
    const scrapeDisabled = enabled.filter((p) => !p.scrape_enabled);

    header('VISIBILITY & SCRAPE TOGGLES');
    console.log(`enabled=true  (shown on site):                       ${enabled.length} (${pct(enabled.length, all.length)})`);
    console.log(`enabled=false (hidden, archived/dead):               ${disabled.length} (${pct(disabled.length, all.length)})`);
    console.log('');
    console.log(`Of the ${enabled.length} visible products:`);
    console.log(`  scrape_enabled=true  (in daily scrape pipeline):   ${scrapeEnabled.length} (${pct(scrapeEnabled.length, enabled.length)})`);
    console.log(`  scrape_enabled=false (manual/hard-priced):         ${scrapeDisabled.length} (${pct(scrapeDisabled.length, enabled.length)})`);

    // ── Extraction method breakdown (visible + scrapable only) ───────────────
    header('EXTRACTION METHOD (visible, scrape_enabled=true)');
    const byMethod = bucketBy(scrapeEnabled, (p) => p.extraction_method ?? 'playwright (default)');
    printDistribution('Method', byMethod, scrapeEnabled.length);

    const layer0 = scrapeEnabled.filter((p) => (p.extraction_method ?? '').startsWith('free_'));
    const feedAwin = scrapeEnabled.filter((p) => p.extraction_method === 'feed_awin');
    const layer1 = scrapeEnabled.filter((p) => !p.extraction_method || p.extraction_method === 'playwright');

    console.log('');
    console.log('Pipeline layer summary (visible + scrape_enabled):');
    console.log(`  Layer 0 (free_*):     ${layer0.length}`);
    console.log(`  Feed (feed_awin):     ${feedAwin.length}`);
    console.log(`  Layer 1 (playwright): ${layer1.length}`);
    console.log(`  Total in pipeline:    ${scrapeEnabled.length} (matches daily-scrape totalCount?)`);

    // ── Pipeline-eligible: excludes feed_awin ────────────────────────────────
    const pipelineEligible = scrapeEnabled.filter((p) => p.extraction_method !== 'feed_awin');
    console.log(`  Excludes feed_awin:   ${pipelineEligible.length} (this is what daily scrape iterates)`);

    // ── Hard-priced workarounds (the user's specific concern) ────────────────
    header('HARD-PRICED WORKAROUNDS (enabled=true, scrape_enabled=false)');
    console.log(`Count: ${scrapeDisabled.length}`);
    const hardPricedByStore = bucketBy(scrapeDisabled, (p) => p.store ?? '(no store)');
    printDistribution('  By store', hardPricedByStore, scrapeDisabled.length);

    // ── Scraper action configuration ─────────────────────────────────────────
    header('SCRAPER ACTIONS (visible products only)');
    const hasActions = enabled.filter((p) => Array.isArray(p.scraper) && p.scraper.length > 0);
    const noActions = enabled.filter((p) => !Array.isArray(p.scraper) || p.scraper.length === 0);
    const hasSelect = enabled.filter(hasSelectAction);
    console.log(`Has any scraper actions:       ${hasActions.length}`);
    console.log(`No scraper actions configured: ${noActions.length}`);
    console.log(`Has a Select action (price):   ${hasSelect.length}`);

    // ── Lock state ───────────────────────────────────────────────────────────
    header('MANUAL LOCK');
    const manualLocked = enabled.filter((p) => p.manual_lock === true);
    console.log(`enabled + manual_lock=true: ${manualLocked.length}`);
    const lockedByStore = bucketBy(manualLocked, (p) => p.store ?? '(no store)');
    if (manualLocked.length > 0) {
        printDistribution('  By store', lockedByStore, manualLocked.length);
    }

    // ── Verification fields (the NEW fields we are about to add) ─────────────
    header('AI VERIFICATION STATE (new fields — likely all undefined right now)');
    const hasVerifiedAt = enabled.filter((p) => (p as Product & { ai_verified_at?: unknown }).ai_verified_at !== undefined);
    const hasDisagreement = enabled.filter((p) => (p as Product & { ai_disagreement_count?: number }).ai_disagreement_count !== undefined);
    console.log(`ai_verified_at set:           ${hasVerifiedAt.length}`);
    console.log(`ai_disagreement_count set:    ${hasDisagreement.length}`);

    // ── Reconciliation ───────────────────────────────────────────────────────
    header('RECONCILIATION');
    console.log(`Total products:                      ${all.length}`);
    console.log(`  - disabled (hidden):               ${disabled.length}`);
    console.log(`  - visible:                         ${enabled.length}`);
    console.log(`      - scrape_enabled=false:        ${scrapeDisabled.length}  (hard-priced, NOT in daily scrape)`);
    console.log(`      - scrape_enabled=true:         ${scrapeEnabled.length}`);
    console.log(`          - feed_awin:               ${feedAwin.length}  (skipped by daily scrape, fed daily)`);
    console.log(`          - Layer 0 (free_*):        ${layer0.length}  (in daily scrape, free)`);
    console.log(`          - Layer 1 (playwright):    ${layer1.length}  (in daily scrape, paid/AI-fallback)`);
    console.log('');
    console.log(`Daily scrape job totalCount should be: ${pipelineEligible.length}`);
    console.log(`(Latest scrape_runs totalCount was 644 according to diagnose-scraper.ts)`);

    // ── Optional list dumps ─────────────────────────────────────────────────
    if (flags.has('--list-hard-priced')) {
        header('HARD-PRICED WORKAROUNDS — FULL LIST');
        for (const p of scrapeDisabled.sort((a, b) => (a.store ?? '').localeCompare(b.store ?? ''))) {
            console.log(`  ${p.id}  ${p.store}/${p.name} — €${p.price} ${p.url}`);
        }
    }
    if (flags.has('--list-no-scraper')) {
        header('NO SCRAPER ACTIONS — FULL LIST');
        for (const p of noActions.sort((a, b) => (a.store ?? '').localeCompare(b.store ?? ''))) {
            console.log(`  ${p.id}  ${p.store}/${p.name}  scrape_enabled=${p.scrape_enabled}`);
        }
    }
    if (flags.has('--list-manual-lock')) {
        header('MANUAL_LOCK — FULL LIST');
        for (const p of manualLocked.sort((a, b) => (a.store ?? '').localeCompare(b.store ?? ''))) {
            console.log(`  ${p.id}  ${p.store}/${p.name}  €${p.price}  ${p.url}`);
        }
    }
    if (flags.has('--list-disabled')) {
        header('DISABLED PRODUCTS (enabled=false) — FULL LIST');
        const byStore = bucketBy(disabled, (p) => p.store ?? '(no store)');
        const stores = Array.from(byStore.entries()).sort((a, b) => b[1].length - a[1].length);
        for (const [storeName, prods] of stores) {
            console.log(`\n--- ${storeName} (${prods.length}) ---`);
            for (const p of prods.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))) {
                console.log(`  ${p.id}  ${String(p.amount).padStart(5)}g  €${(p.price ?? 0).toFixed(2).padStart(7)}  ${p.name}`);
                console.log(`         ${(p.url ?? '').slice(0, 130)}`);
            }
        }
    }
    if (flags.has('--write-disabled-md')) {
        const path = process.argv[process.argv.indexOf('--write-disabled-md') + 1];
        if (!path) throw new Error('--write-disabled-md requires a path argument');
        const { writeFile } = await import('node:fs/promises');
        const lines: string[] = [];
        lines.push('# Disabled Products — Manual Review');
        lines.push('');
        lines.push(`_Generated ${new Date().toISOString()} — ${disabled.length} disabled products grouped by store._`);
        lines.push('');
        lines.push('Most are disabled because the scraper never worked properly (price=€0 or absurd parse-bug values). Goal: re-enable everything we can recover. For each, decide:');
        lines.push('');
        lines.push('- ✅ **Re-enable** — product is still sold, we just need verify-with-ai to find a working selector');
        lines.push('- 🔁 **Update URL first** — current URL is dead, give new URL then re-enable');
        lines.push('- ⛔️ **Keep disabled** — product genuinely discontinued, leave alone');
        lines.push('');
        lines.push('Mark `[x]` for re-enable candidates. Use `[!]` if URL needs updating (write new URL below). Leave `[ ]` to skip.');
        lines.push('');
        const byStore = bucketBy(disabled, (p) => p.store ?? '(no store)');
        const stores = Array.from(byStore.entries()).sort((a, b) => b[1].length - a[1].length);
        for (const [storeName, prods] of stores) {
            lines.push(`## ${storeName} (${prods.length})`);
            lines.push('');
            for (const p of prods.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))) {
                lines.push(`- [ ] **${p.name}** — ${p.amount}g — €${(p.price ?? 0).toFixed(2)}`);
                lines.push(`  - id: \`${p.id}\``);
                lines.push(`  - url: ${p.url ?? '(no url)'}`);
                lines.push(`  - new url (only if current is dead): \`-\``);
            }
            lines.push('');
        }
        await writeFile(path, lines.join('\n'), 'utf-8');
        console.log(`Wrote disabled list to ${path}`);
    }
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Inventory failed:', err);
    process.exit(1);
});
