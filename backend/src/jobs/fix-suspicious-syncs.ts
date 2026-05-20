/**
 * Apply the specific corrections from SPOTCHECK.md review (2026-05-20).
 *
 * Each product gets one of:
 *  - REPLACE_SCRAPER: replace existing scraper[] with a single Select action using
 *    a user-provided XPath, set manual_lock=true. Used for Zumub/VPlab where the
 *    user already knows the stable selector and AI was misled by per-unit prices.
 *  - LOCK_ONLY: scraper is already correct (has ClickByText/Click for variant picker);
 *    just set manual_lock=true so future verify-with-ai runs do not override it again.
 *  - PREPEND_CLICK: scraper has a working Select but is missing a ClickByText for
 *    the variant size — prepend it. Set manual_lock=true.
 *  - DISABLE: product URL is dead, set enabled=false.
 *
 * Run with:
 *   pnpm tsx src/jobs/fix-suspicious-syncs.ts             # dry-run
 *   pnpm tsx src/jobs/fix-suspicious-syncs.ts -- --apply  # write to Firestore
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { db } from '../db/firebase.js';
import type { Product, ProductUpdate, ScraperAction } from '@eiwittens/types';
import { ActionType, SelectorType } from '@eiwittens/types';

type Action =
    | { kind: 'REPLACE_SCRAPER'; selectorType: SelectorType; selectorValue: string; note: string }
    | { kind: 'LOCK_ONLY'; note: string }
    | { kind: 'PREPEND_CLICK'; sizeText: string; note: string }
    | { kind: 'DISABLE'; note: string };

const FIXES: Array<{ id: string; label: string; action: Action }> = [
    // ── Zumub: itemprop=price gives €/gram. Replace with user-provided stable XPath. ──
    {
        id: 'Nad25tK7Ov1UMnfwZ4Ej',
        label: 'Zumub 100% Whey Concentraat | 1kg',
        action: {
            kind: 'REPLACE_SCRAPER',
            selectorType: SelectorType.Xpath,
            selectorValue: '//*[@id="page-content-wrapper"]/div[3]/div[1]/div[2]/div[2]/div/div/div[2]/form/div/div[1]/div[2]/div[4]/span[1]/span/b',
            note: 'Zumub itemprop=price gave €/gram unit; user provided stable XPath',
        },
    },
    {
        id: 'FicQL9Q4WC9bf8GQighh',
        label: 'Zumub 100% Whey Concentraat | 2kg',
        action: {
            kind: 'REPLACE_SCRAPER',
            selectorType: SelectorType.Xpath,
            selectorValue: '//*[@id="page-content-wrapper"]/div[3]/div[1]/div[2]/div[2]/div/div/div[2]/form/div/div[1]/div[2]/div[4]/span[1]/span/b',
            note: 'Zumub itemprop=price gave €/gram unit',
        },
    },
    {
        id: 'xJMzvpE6rQBefGRiL1AR',
        label: 'Zumub 100% Whey Concentrate | 4kg',
        action: {
            kind: 'REPLACE_SCRAPER',
            selectorType: SelectorType.Xpath,
            selectorValue: '//*[@id="page-content-wrapper"]/div[3]/div[1]/div[2]/div[2]/div/div/div[2]/form/div/div[1]/div[2]/div[4]/span[1]/span/b',
            note: 'Zumub itemprop=price gave €/gram unit',
        },
    },
    {
        id: 'aCIy3QokkucW5Rh8wbsy',
        label: 'Zumub Creatine Monohydrate | 1kg',
        action: {
            kind: 'REPLACE_SCRAPER',
            selectorType: SelectorType.Xpath,
            selectorValue: '//*[@id="page-content-wrapper"]/div[3]/div[1]/div[2]/div[2]/div/div/div[2]/form/div/div[1]/div[2]/div[4]/span[1]/span/b',
            note: 'Zumub itemprop=price gave €/gram unit',
        },
    },

    // ── VPlab ──
    {
        id: 'L3i2WBYNuC6CjgkP6XoN',
        label: 'VPlab Protein Milkshake | 500g',
        action: {
            kind: 'REPLACE_SCRAPER',
            selectorType: SelectorType.Xpath,
            selectorValue: '//*[@id="shopify-section-template--20286050566474__main"]/div/div[2]/div[2]/div/div[3]/div[1]/div/div/span/span',
            note: 'AI hallucinated low price; user provided correct shopify XPath',
        },
    },

    // ── Action Bodymass: dead product, disable ──
    {
        id: 'BFV8UjWXDTowxgqCuKOq',
        label: 'Action Bodymass Mass Gainer | 1kg',
        action: { kind: 'DISABLE', note: 'old product, URL dead' },
    },

    // ── Variant pickers — scraper already correct, just lock it ──
    {
        id: 'XfZquBgcLx1OGiuv5uQB',
        label: 'Bulk Pure Whey Isolate | 5kg',
        action: { kind: 'LOCK_ONLY', note: 'has ClickByText(5kg) + correct Select' },
    },
    {
        id: 'HkBGwImjpywrnl688hfo',
        label: 'Bulk Pure Whey Protein | 5kg',
        action: { kind: 'LOCK_ONLY', note: 'has ClickByText(5kg) + correct Select' },
    },
    {
        id: '9s89QyZql1LXZy19RMyS',
        label: 'Bulk Vegan Protein | 5kg',
        action: { kind: 'LOCK_ONLY', note: 'has ClickByText(5kg) + correct Select' },
    },
    {
        id: 'wVTRcH49uckgT5jDsEDM',
        label: 'BodySupplies Mutant Whey | 4,5kg',
        action: { kind: 'LOCK_ONLY', note: 'has variant click + correct Select' },
    },
    {
        id: 'HxU81C53dG56KhuqA2d9',
        label: 'Naturaplaza Whey Bio | 20kg',
        action: { kind: 'LOCK_ONLY', note: 'has cookie + size click + correct Select' },
    },
    {
        id: 'Dk5Druf2GLfk3u6wbKxh',
        label: 'Naturaplaza Whey Bio | 5kg',
        action: { kind: 'LOCK_ONLY', note: 'has cookie + size click + correct Select' },
    },
    {
        id: 'iqHvXFitifIq6e3ARhkA',
        label: 'Naturaplaza Whey Bio | 1kg',
        action: { kind: 'LOCK_ONLY', note: 'has cookie + size click + correct Select' },
    },
    {
        id: 'pFcTGVjrpNw9NWyVvGak',
        label: 'Natuurlijk Natuurlijk Ei-eiwit | 6kg',
        action: { kind: 'LOCK_ONLY', note: 'has cookie click + correct Select' },
    },

    // ── Missing ClickByText — prepend ──
    {
        id: 'XWlUAmmqKqv8VTpkudF9',
        label: 'XXLNutrition Perfect Whey | 4kg',
        action: { kind: 'PREPEND_CLICK', sizeText: '4kg', note: 'XXL needs 4kg variant click before reading price' },
    },
    {
        id: '9XVeGrt0gK5qCbX6cbpP',
        label: 'VanBeekumSpecerijen Whey 15kg',
        action: { kind: 'PREPEND_CLICK', sizeText: '15kg', note: 'VanBeekum needs 15kg variant click' },
    },
];

function newAction(): ScraperAction {
    return {} as ScraperAction; // placeholder
}

function buildReplaceSelectScraper(selectorType: SelectorType, selectorValue: string): ScraperAction[] {
    return [
        {
            id: crypto.randomUUID(),
            type: ActionType.Select,
            selectorType,
            selectorValue,
        },
    ];
}

function buildPrependClickScraper(existing: ScraperAction[], sizeText: string): ScraperAction[] {
    const click: ScraperAction = {
        id: crypto.randomUUID(),
        type: ActionType.ClickByText,
        text: sizeText,
    };
    const wait: ScraperAction = {
        id: crypto.randomUUID(),
        type: ActionType.Wait,
        duration: 1500,
    };
    return [click, wait, ...existing];
}

async function main(): Promise<void> {
    const apply = process.argv.includes('--apply');
    console.log(`[fix-suspicious-syncs] Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
    console.log(`[fix-suspicious-syncs] Fixes queued: ${FIXES.length}\n`);

    let updated = 0;
    let errors = 0;

    for (const fix of FIXES) {
        const ref = db.collection('products').doc(fix.id);
        const snap = await ref.get();
        if (!snap.exists) {
            console.log(`  ✗ ${fix.id}  ${fix.label}  NOT FOUND`);
            errors += 1;
            continue;
        }
        const p = snap.data() as Product;
        const update: ProductUpdate = {};

        switch (fix.action.kind) {
            case 'REPLACE_SCRAPER':
                update.scraper = buildReplaceSelectScraper(fix.action.selectorType, fix.action.selectorValue);
                update.manual_lock = true;
                break;
            case 'LOCK_ONLY':
                update.manual_lock = true;
                break;
            case 'PREPEND_CLICK':
                update.scraper = buildPrependClickScraper(p.scraper ?? [], fix.action.sizeText);
                update.manual_lock = true;
                break;
            case 'DISABLE':
                update.enabled = false;
                update.scrape_enabled = false;
                break;
        }

        console.log(`  ${apply ? '✓' : '↻'} ${fix.id}  [${fix.action.kind}]  ${fix.label}`);
        console.log(`      ${fix.action.note}`);
        if (apply) {
            try {
                await ref.update(update as Record<string, unknown>);
                updated += 1;
            } catch (err) {
                errors += 1;
                console.error(`      ERROR: ${(err as Error).message}`);
            }
        }
    }

    console.log('');
    console.log(`[fix-suspicious-syncs] ${apply ? `Done. updated=${updated} errors=${errors}` : 'DRY RUN — pass --apply to write'}`);
    if (apply) {
        console.log('[fix-suspicious-syncs] Next step: run scrape-local on these IDs to refresh price field with the correct extracted value.');
    }
    void newAction;
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Failed:', err);
    process.exit(1);
});
