/**
 * Read-only inspector: dump the current state of specific products' scraper[] arrays.
 * Used to determine whether a product's broken XPath will be auto-fixed by the
 * Layer 2 AI fallback on next scrape, or whether manual intervention is needed.
 *
 * Usage:
 *   pnpm tsx src/jobs/inspect-product-scrapers.ts <id1> <id2> ...
 *   pnpm tsx src/jobs/inspect-product-scrapers.ts --file path/to/ids.txt
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { db } from '../db/firebase.js';
import type { Product, ScraperAction } from '@eiwittens/types';
import { ActionType, SelectorType } from '@eiwittens/types';

interface InspectionResult {
    id: string;
    name?: string;
    store?: string;
    url?: string;
    enabled?: boolean;
    scrape_enabled?: boolean;
    extraction_method?: string;
    manual_lock?: boolean;
    actionCount: number;
    selectActions: Array<{ selectorType: SelectorType; selectorValue: string }>;
    otherActions: Array<{ type: ActionType; summary: string }>;
    classification: 'EMPTY' | 'XPATH_ONLY' | 'HAS_CLICKS' | 'NOT_FOUND' | 'NO_SCRAPER_FIELD';
}

function actionSummary(a: ScraperAction): string {
    switch (a.type) {
        case ActionType.Click:
        case ActionType.Select:
            return `${a.type}(${a.selectorType}=${a.selectorValue})`;
        case ActionType.ClickByText:
            return `${a.type}(text="${a.text}"${a.scopeSelector ? `, scope=${a.scopeSelector}` : ''})`;
        case ActionType.SelectOption:
            return `${a.type}(${a.selectorType}=${a.selectorValue}, option="${a.optionText}")`;
        case ActionType.Wait:
            return `${a.type}(${a.duration ?? 2000}ms)`;
        default:
            return JSON.stringify(a).slice(0, 80);
    }
}

function classify(scraper: ScraperAction[] | undefined): InspectionResult['classification'] {
    if (!Array.isArray(scraper)) return 'NO_SCRAPER_FIELD';
    if (scraper.length === 0) return 'EMPTY';
    const hasClicks = scraper.some((a) => a.type === ActionType.Click || a.type === ActionType.ClickByText || a.type === ActionType.SelectOption);
    if (hasClicks) return 'HAS_CLICKS';
    return 'XPATH_ONLY';
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    let ids: string[];
    const fileIdx = args.indexOf('--file');
    if (fileIdx >= 0) {
        const path = args[fileIdx + 1];
        if (!path) throw new Error('--file requires a path');
        ids = readFileSync(path, 'utf-8').split('\n').map((s) => s.trim()).filter(Boolean);
    } else {
        ids = args.filter((a) => !a.startsWith('--'));
    }
    if (ids.length === 0) {
        console.error('No product IDs provided. Pass as args or via --file <path>.');
        process.exit(1);
    }

    console.log(`Inspecting ${ids.length} products...\n`);

    const results: InspectionResult[] = [];

    for (const id of ids) {
        const docRef = db.collection('products').doc(id);
        const snap = await docRef.get();
        if (!snap.exists) {
            results.push({ id, actionCount: 0, selectActions: [], otherActions: [], classification: 'NOT_FOUND' });
            continue;
        }
        const p = snap.data() as Product;
        const scraper = p.scraper ?? [];
        results.push({
            id,
            name: p.name,
            store: p.store,
            url: p.url,
            enabled: p.enabled,
            scrape_enabled: p.scrape_enabled,
            extraction_method: p.extraction_method ?? 'playwright (default)',
            manual_lock: p.manual_lock,
            actionCount: scraper.length,
            selectActions: scraper
                .filter((a): a is Extract<ScraperAction, { type: ActionType.Select }> => a.type === ActionType.Select)
                .map((a) => ({ selectorType: a.selectorType, selectorValue: a.selectorValue })),
            otherActions: scraper
                .filter((a) => a.type !== ActionType.Select)
                .map((a) => ({ type: a.type, summary: actionSummary(a) })),
            classification: classify(scraper),
        });
    }

    // Detailed per-product output
    for (const r of results) {
        console.log(`── ${r.id} ──`);
        if (r.classification === 'NOT_FOUND') {
            console.log('   NOT FOUND in Firestore.\n');
            continue;
        }
        console.log(`   ${r.store} — ${r.name}`);
        console.log(`   URL: ${r.url}`);
        console.log(`   enabled=${r.enabled} scrape_enabled=${r.scrape_enabled} method=${r.extraction_method}${r.manual_lock ? ' manual_lock=TRUE' : ''}`);
        console.log(`   actions: ${r.actionCount} (${r.classification})`);
        for (const sel of r.selectActions) {
            console.log(`     SELECT  ${sel.selectorType}=${sel.selectorValue}`);
        }
        for (const o of r.otherActions) {
            console.log(`     OTHER   ${o.summary}`);
        }
        console.log('');
    }

    // Summary table
    console.log('\n=== Classification summary ===\n');
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.classification] = (counts[r.classification] ?? 0) + 1;
    for (const [cls, count] of Object.entries(counts)) {
        console.log(`  ${cls.padEnd(20)} ${count}`);
    }
    console.log('');
    console.log('Interpretation:');
    console.log('  EMPTY              → next scrape will auto-engage AI fallback (no manual work needed)');
    console.log('  XPATH_ONLY (stale) → AI fallback only kicks in if XPath throws; may need force-trigger');
    console.log('  HAS_CLICKS         → variant-aware scraper; clicks may still work, XPath may need fix');
    console.log('  NO_SCRAPER_FIELD   → product never configured; AI fallback will handle');
    console.log('  NOT_FOUND          → product ID invalid');
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Inspection failed:', err);
    process.exit(1);
});
