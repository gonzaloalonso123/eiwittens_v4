// Step 2: refresh Body&Fit URLs after their migration to Shopify.
// Old URLs (/nl-nl/Producten/.../p/p_XXXXX) now 404. New URLs are /products/<handle>.
// Use Body&Fit's Shopify suggest endpoint to find new URL per product, then update
// + flag extraction_method=free_shopify so they use Layer 0 going forward.

import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..', 'full-audit-reports');
const BF_ORIGIN = 'https://www.bodyandfit.com';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'nl-NL,nl;q=0.9',
};

interface AuditResult {
    productId: string;
    name: string;
    store: string;
    url: string;
    gg_price: number;
    verdict: string;
}

interface ShopifySuggestProduct {
    handle: string;
    title: string;
    url: string;
    price: string;
}

function cleanName(name: string): string {
    // Strip " | <size>" suffix and trim
    return name.replace(/\s*\|.*$/, '').trim();
}

async function searchBodyAndFit(query: string): Promise<ShopifySuggestProduct[]> {
    const url = `${BF_ORIGIN}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=10`;
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = await res.json() as { resources?: { results?: { products?: ShopifySuggestProduct[] } } };
    return data?.resources?.results?.products ?? [];
}

const FORM_WORDS_POWDER = ['powder', 'poeder', 'poweder', 'milkshake', 'shake'];
const FORM_WORDS_BAR = ['bar', 'reep', 'repen', 'snack'];
const FORM_WORDS_CAPSULE = ['capsules', 'capsule', 'caps', 'tabs', 'tabletten', 'tablet', 'pillen', 'super-tabs'];

function detectForm(name: string): 'powder' | 'bar' | 'capsule' | 'unknown' {
    const low = name.toLowerCase();
    if (FORM_WORDS_BAR.some((w) => low.includes(w))) return 'bar';
    if (FORM_WORDS_CAPSULE.some((w) => low.includes(w))) return 'capsule';
    if (FORM_WORDS_POWDER.some((w) => low.includes(w))) return 'powder';
    return 'unknown';
}

function tokenize(s: string): string[] {
    return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
        .filter((w) => w.length > 2)
        .filter((w) => !/^\d+(g|kg|gr|gram|ml)?$/.test(w))  // strip sizes
        .filter((w) => !['organic', 'biologisch', 'bio'].includes(w));  // descriptors
}

function scoreMatch(productName: string, suggestTitle: string): { score: number; total: number; formOk: boolean } {
    const pt = tokenize(productName);
    const st = tokenize(suggestTitle);
    const score = pt.filter((t) => st.some((s) => s === t || s.includes(t) || t.includes(s))).length;

    // Form check: if source is powder (or unknown), target must NOT be bar or capsule
    const srcForm = detectForm(productName);
    const tgtForm = detectForm(suggestTitle);
    let formOk = true;
    if (srcForm === 'powder' && (tgtForm === 'bar' || tgtForm === 'capsule')) formOk = false;
    if (srcForm === 'unknown' && (tgtForm === 'bar' || tgtForm === 'capsule')) formOk = false;
    if (srcForm === 'bar' && tgtForm !== 'bar' && tgtForm !== 'unknown') formOk = false;
    if (srcForm === 'capsule' && tgtForm !== 'capsule' && tgtForm !== 'unknown') formOk = false;

    return { score, total: pt.length, formOk };
}

interface Plan {
    productId: string;
    name: string;
    current_url: string;
    new_url?: string;
    new_handle?: string;
    suggest_title?: string;
    score?: number;
    action: 'refresh_url_and_layer0' | 'flag_review' | 'no_match';
    reason: string;
}

const apply = process.argv.includes('--apply');
console.log(`[bf-fix] Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

// Load audit
const files = (await readdir(AUDIT_DIR)).filter((f) => f.endsWith('.json')).sort();
const audit = JSON.parse(await readFile(resolve(AUDIT_DIR, files[files.length - 1]), 'utf-8')) as AuditResult[];

// Target Body&Fit products that hard_failed or silently_wrong
const targets = audit.filter((r) => r.store === 'Body&Fit' && (r.verdict === 'hard_failed' || r.verdict === 'silently_wrong'));
console.log(`[bf-fix] Targeting ${targets.length} Body&Fit products`);

const plans: Plan[] = [];
for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    const query = cleanName(r.name);
    try {
        const matches = await searchBodyAndFit(query);
        if (matches.length === 0) {
            plans.push({ productId: r.productId, name: r.name, current_url: r.url, action: 'no_match', reason: 'Shopify suggest returned 0 matches' });
            console.log(`  [${i + 1}/${targets.length}] ✗ ${r.name.slice(0, 50)} — no match`);
            continue;
        }
        // Score each match WITH form-check
        const scored = matches.map((m) => {
            const s = scoreMatch(r.name, m.title);
            return { ...m, ...s, combinedScore: s.formOk ? s.score : -1 };
        }).sort((a, b) => b.combinedScore - a.combinedScore);
        const best = scored[0];

        // Require: form must match AND >= 80% of source tokens (or all-but-one)
        const minScore = Math.max(2, best.total - 1);
        if (!best.formOk || best.score < minScore) {
            plans.push({
                productId: r.productId, name: r.name, current_url: r.url,
                suggest_title: best.title, score: best.score,
                action: 'flag_review',
                reason: `Best match "${best.title}" — form_ok=${best.formOk}, ${best.score}/${best.total} tokens. Manual verify.`,
            });
            const formInfo = best.formOk ? '' : ' [form mismatch]';
            console.log(`  [${i + 1}/${targets.length}] ? ${r.name.slice(0, 40)} → "${best.title.slice(0, 30)}" (${best.score}/${best.total})${formInfo}`);
            continue;
        }

        const newUrl = best.url.startsWith('http') ? best.url : `${BF_ORIGIN}${best.url}`;
        plans.push({
            productId: r.productId,
            name: r.name,
            current_url: r.url,
            new_url: newUrl.split('?')[0],
            new_handle: best.handle,
            suggest_title: best.title,
            score: best.score,
            action: 'refresh_url_and_layer0',
            reason: `Matched "${best.title}" (${best.score}/${best.total} tokens, form ok). New Shopify URL.`,
        });
        console.log(`  [${i + 1}/${targets.length}] ✓ ${r.name.slice(0, 40)} → ${best.handle} (${best.score}/${best.total})`);
    } catch (err) {
        plans.push({ productId: r.productId, name: r.name, current_url: r.url, action: 'no_match', reason: `Search error: ${(err as Error).message}` });
        console.log(`  [${i + 1}/${targets.length}] ✗ ${r.name.slice(0, 50)} — search error`);
    }
}

const counts = { refresh_url_and_layer0: 0, flag_review: 0, no_match: 0 };
for (const p of plans) counts[p.action]++;

console.log('');
console.log(`[bf-fix] Plan: ${counts.refresh_url_and_layer0} refresh + free_shopify | ${counts.flag_review} flag_review | ${counts.no_match} no_match`);
console.log('');

if (!apply) {
    console.log('[bf-fix] DRY RUN — pass --apply to write to Firestore');
    process.exit(0);
}

console.log('[bf-fix] APPLYING...');
const { db } = await import('../db/firebase.js');
const collection = db.collection('products');

let updated = 0;
let failed = 0;
for (const p of plans) {
    if (p.action !== 'refresh_url_and_layer0' || !p.new_url) continue;
    try {
        await collection.doc(p.productId).update({
            url: p.new_url,
            extraction_method: 'free_shopify',
        });
        updated++;
    } catch (err) {
        failed++;
        console.error(`  ✗ ${p.name}: ${(err as Error).message}`);
    }
}
console.log(`[bf-fix] Done. ${updated} updated, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
