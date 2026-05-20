// Bulk URL refresh: reads DEAD-URLS-TO-REFRESH.md, parses the "NIEUWE URL:" lines
// the user filled in, then for each filled-in URL:
//   1. Live-tests it with Free Extractor (plain HTTP).
//   2. If a realistic price comes back → set url + extraction_method=free_*  + re-enable.
//   3. If no Free price → set url only, re-enable, keep extraction_method=playwright.
//      (User will need to fix the XPath via dashboard.)
//   4. If URL itself returns 404/403 → skip + log.
//
// Run with:
//   pnpm tsx src/jobs/refresh-dead-urls.ts             # dry run
//   pnpm tsx src/jobs/refresh-dead-urls.ts -- --apply  # write to Firestore

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFreePrice, NoFreeExtractionAvailable } from '../scraper/free-extractor.js';

const MD_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'DEAD-URLS-TO-REFRESH.md');

interface Entry {
    productId: string;
    name: string;
    newUrl: string;
    /** Set when the user appended "(nu 500g)" or similar to the NIEUWE URL line. */
    newAmount?: number;
    rawAmountNote?: string;
}

/**
 * Parse free-text amount notations like "500g", "3x960g", "1,2kg", "90g" into grams.
 * Returns null when no number can be confidently extracted.
 */
function parseAmountString(s: string): number | null {
    const low = s.toLowerCase().replace(/\s+/g, '');
    // Multiplied packs: "3x960g" or "2x1kg"
    const multi = low.match(/(\d+)x([\d.,]+)(kg|g|gr)/);
    if (multi) {
        const factor = parseInt(multi[1], 10);
        const each = parseFloat(multi[2].replace(',', '.'));
        const unit = multi[3];
        if (Number.isFinite(factor) && Number.isFinite(each)) {
            return Math.round(factor * each * (unit === 'kg' ? 1000 : 1));
        }
    }
    // Plain: "1,2kg" / "500g" / "90gr"
    const plain = low.match(/([\d.,]+)(kg|g|gr)/);
    if (plain) {
        const v = parseFloat(plain[1].replace(',', '.'));
        const unit = plain[2];
        if (Number.isFinite(v)) return Math.round(v * (unit === 'kg' ? 1000 : 1));
    }
    return null;
}

async function parseMarkdown(): Promise<Entry[]> {
    const md = await readFile(MD_PATH, 'utf-8');
    const lines = md.split('\n');
    const entries: Entry[] = [];

    let currentName: string | null = null;
    let currentPid: string | null = null;
    let currentNewUrl: string | null = null;
    let currentNewAmount: number | undefined;
    let currentRawNote: string | undefined;

    const flush = () => {
        if (currentPid && currentNewUrl && currentNewUrl.startsWith('http')) {
            entries.push({
                productId: currentPid,
                name: currentName ?? '?',
                newUrl: currentNewUrl,
                newAmount: currentNewAmount,
                rawAmountNote: currentRawNote,
            });
        }
        currentName = currentPid = currentNewUrl = null;
        currentNewAmount = undefined;
        currentRawNote = undefined;
    };

    for (const line of lines) {
        const m = line.match(/^- \*\*(.+?)\*\* —/);
        if (m) {
            flush();
            currentName = m[1];
            continue;
        }
        const pidMatch = line.match(/products\/edit\/([A-Za-z0-9]+)/);
        if (pidMatch) currentPid = pidMatch[1];

        const newUrlMatch = line.match(/^\s+- NIEUWE URL:\s*(\S+)(?:\s+\((.+?)\))?\s*$/);
        if (newUrlMatch) {
            currentNewUrl = newUrlMatch[1].trim();
            const note = newUrlMatch[2];
            if (note) {
                currentRawNote = note;
                const parsed = parseAmountString(note);
                if (parsed != null) currentNewAmount = parsed;
            }
        }
    }
    flush();
    return entries;
}

const apply = process.argv.includes('--apply');
console.log(`[refresh-dead] Mode: ${apply ? 'APPLY' : 'DRY RUN'}\n`);

const entries = await parseMarkdown();
console.log(`[refresh-dead] Found ${entries.length} entries with a filled-in NIEUWE URL\n`);

if (entries.length === 0) {
    console.log('Nothing to do. Fill in some "NIEUWE URL:" lines in DEAD-URLS-TO-REFRESH.md first.');
    process.exit(0);
}

interface Plan {
    pid: string;
    name: string;
    url: string;
    action: 'free_jsonld' | 'free_shopify' | 'free_og' | 'free_microdata' | 'url_only' | 'skip';
    reason: string;
    price?: number;
    newAmount?: number;
    rawAmountNote?: string;
}

const plans: Plan[] = [];
for (const e of entries) {
    const amountTag = e.newAmount ? ` [amount→${e.newAmount}g]` : '';
    process.stdout.write(`[${e.productId}] ${e.name.slice(0, 40).padEnd(40)}${amountTag.padEnd(18)} ... `);
    const base = { pid: e.productId, name: e.name, url: e.newUrl, newAmount: e.newAmount, rawAmountNote: e.rawAmountNote };
    try {
        const result = await extractFreePrice(e.newUrl);
        if (result.price > 0.5 && result.price < 1500) {
            const action = `free_${result.method === 'shopify_json' ? 'shopify' : result.method}` as Plan['action'];
            plans.push({ ...base, action, reason: `Free returned €${result.price}`, price: result.price });
            console.log(`✓ €${result.price} (${result.method})`);
        } else {
            plans.push({ ...base, action: 'url_only', reason: 'Free returned unrealistic, set URL only — XPath fix needed' });
            console.log(`⚠ unrealistic €${result.price}, set URL only`);
        }
    } catch (err) {
        if (err instanceof NoFreeExtractionAvailable) {
            plans.push({ ...base, action: 'url_only', reason: 'No structured data, set URL only — XPath fix needed' });
            console.log(`⚠ no structured data, set URL only`);
        } else {
            const msg = (err as Error).message;
            if (msg.includes('HTTP 404')) {
                plans.push({ ...base, action: 'skip', reason: 'NEW URL also returns 404' });
                console.log(`✗ NEW URL also 404 — skipped`);
            } else {
                plans.push({ ...base, action: 'url_only', reason: `Fetch error: ${msg.slice(0, 80)}` });
                console.log(`⚠ fetch error: ${msg.slice(0, 60)}, set URL only`);
            }
        }
    }
}

const counts = { free: 0, url_only: 0, skip: 0 };
for (const p of plans) {
    if (p.action.startsWith('free_')) counts.free++;
    else if (p.action === 'url_only') counts.url_only++;
    else counts.skip++;
}

console.log('');
console.log(`[refresh-dead] Plan: ${counts.free} Layer-0 wins | ${counts.url_only} URL-only refresh (XPath fix needed) | ${counts.skip} skip`);
const amountChanges = plans.filter((p) => p.newAmount && p.action !== 'skip');
if (amountChanges.length > 0) {
    console.log(`[refresh-dead] Amount overrides (from "(... )" notes): ${amountChanges.length}`);
    for (const p of amountChanges) {
        console.log(`  ${p.pid} ${p.name.slice(0, 40)} → amount=${p.newAmount}g (note: "${p.rawAmountNote}")`);
    }
}
console.log('');

if (!apply) {
    console.log('[refresh-dead] DRY RUN — pass --apply to write to Firestore');
    process.exit(0);
}

console.log('[refresh-dead] APPLYING...');
const { db } = await import('../db/firebase.js');
const collection = db.collection('products');

let updated = 0;
let failed = 0;
for (const p of plans) {
    if (p.action === 'skip') continue;
    const patch: Record<string, unknown> = {
        url: p.url,
        enabled: true,
        scrape_enabled: true,
        out_of_stock: false,
    };
    if (p.action.startsWith('free_')) patch.extraction_method = p.action;
    if (p.newAmount) patch.amount = p.newAmount;

    try {
        await collection.doc(p.pid).update(patch);
        updated++;
        console.log(`  ✓ ${p.name.slice(0, 45)} — ${p.action}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${p.name}: ${(err as Error).message}`);
    }
}
console.log('');
console.log(`[refresh-dead] Done. ${updated} updated, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
