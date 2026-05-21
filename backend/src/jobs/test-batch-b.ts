// One-shot: validate the 14 BATCH B URLs with Free Extractor before re-enabling.
// Reads /tmp/batch-b-urls.json (productId/store/name/url), runs Free Extractor
// in auto mode (plain fetch only — no Playwright), and prints whether each URL
// yields a realistic price.

import { readFile } from 'node:fs/promises';
import { extractFreePrice, NoFreeExtractionAvailable } from '../scraper/free-extractor.js';

interface Row { productId: string; store: string; name: string; url: string }

const sourcePath = process.argv.find((a) => a.endsWith('.json')) ?? '/tmp/batch-b-urls.json';
const rows = JSON.parse(await readFile(sourcePath, 'utf-8')) as Row[];
console.log(`[batch-b-test] Source: ${sourcePath}`);

console.log(`[batch-b-test] Testing Free Extractor on ${rows.length} URLs...\n`);

interface Outcome { row: Row; ok: boolean; price?: number; method?: string; error?: string }
const outcomes: Outcome[] = [];

for (const r of rows) {
    process.stdout.write(`[${r.store.padEnd(18).slice(0, 18)}] ${r.name.slice(0, 45).padEnd(45)} ... `);
    try {
        const result = await extractFreePrice(r.url);
        if (result.price && result.price > 0.5 && result.price < 1000) {
            console.log(`✓ €${result.price} (${result.method}, fetch=${result.fetch_method})`);
            outcomes.push({ row: r, ok: true, price: result.price, method: result.method });
        } else {
            console.log(`⚠ unrealistic €${result.price} (${result.method})`);
            outcomes.push({ row: r, ok: false, price: result.price, method: result.method, error: 'unrealistic price' });
        }
    } catch (err) {
        const msg = err instanceof NoFreeExtractionAvailable
            ? err.reasons.join('; ')
            : (err as Error).message.slice(0, 80);
        console.log(`✗ ${msg}`);
        outcomes.push({ row: r, ok: false, error: msg });
    }
}

const ok = outcomes.filter((o) => o.ok);
const bad = outcomes.filter((o) => !o.ok);

console.log('');
console.log(`[batch-b-test] ${ok.length}/${rows.length} OK, ${bad.length} failed/unrealistic`);
console.log('');

if (bad.length > 0) {
    console.log('Failed URLs (do NOT re-enable):');
    for (const o of bad) {
        console.log(`  ${o.row.productId} [${o.row.store}] ${o.row.name.slice(0, 45)} — ${o.error}`);
    }
}

if (ok.length > 0) {
    console.log('');
    console.log('OK URLs (safe to re-enable):');
    for (const o of ok) {
        console.log(`  ${o.row.productId}\t${o.method}\t€${o.price}\t${o.row.store} - ${o.row.name.slice(0, 40)}`);
    }
}

process.exit(0);
