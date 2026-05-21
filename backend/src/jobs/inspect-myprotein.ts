/**
 * One-off inspector for MyProtein scope + URL collisions. Read-only.
 * Used to figure out how many MyProtein products exist, how many share URLs
 * (multi-variant scrapers), and which scraper actions they have.
 */
import 'dotenv/config';
import { db } from '../db/firebase.js';
import type { Product } from '@eiwittens/types';
import { ActionType } from '@eiwittens/types';

async function main(): Promise<void> {
    const snap = await db.collection('products').where('store', '==', 'MyProtein').get();
    const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) })) as Product[];

    const enabled = all.filter((p) => p.enabled);
    const scrapable = enabled.filter((p) => p.scrape_enabled);
    const hardPriced = enabled.filter((p) => !p.scrape_enabled);

    console.log('MyProtein totals:');
    console.log(`  Total in Firestore:                 ${all.length}`);
    console.log(`  Disabled (hidden):                  ${all.length - enabled.length}`);
    console.log(`  Active (enabled=true):              ${enabled.length}`);
    console.log(`    scrape_enabled=true:              ${scrapable.length}`);
    console.log(`    scrape_enabled=false (hard-priced): ${hardPriced.length}`);
    console.log('');

    // URL collision check (ignoring query string)
    const urlGroups = new Map<string, Product[]>();
    for (const p of enabled) {
        const url = (p.url ?? '').split('?')[0];
        if (!urlGroups.has(url)) urlGroups.set(url, []);
        urlGroups.get(url)!.push(p);
    }
    const collisions = Array.from(urlGroups.entries()).filter(([, v]) => v.length > 1);
    console.log(`URL collisions (multiple GG products sharing the same URL path):`);
    console.log(`  Collision groups: ${collisions.length}`);
    console.log(`  Affected products: ${collisions.reduce((sum, [, v]) => sum + v.length, 0)}`);
    console.log('');

    for (const [url, prods] of collisions) {
        console.log(`  → ${prods.length} products at ${url.slice(0, 90)}`);
        for (const p of prods) {
            const hasClickByText = (p.scraper ?? []).some((a) => a.type === ActionType.ClickByText);
            const hasSelectOption = (p.scraper ?? []).some((a) => a.type === ActionType.SelectOption);
            const hasVariationParam = /[?&]variation=\d/.test(p.url ?? '');
            console.log(
                `       • ${String(p.amount).padStart(5)}g — ${p.name} ` +
                `[scrape_enabled=${p.scrape_enabled}` +
                ` ClickByText=${hasClickByText} SelectOption=${hasSelectOption}` +
                ` variation_in_url=${hasVariationParam}]`,
            );
        }
    }

    // Disabled list — what user wants to see
    const disabled = all.filter((p) => !p.enabled);
    console.log('');
    console.log(`Disabled MyProtein products (${disabled.length}) — review whether to re-enable:`);
    for (const p of disabled.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))) {
        console.log(`  ${p.id}  ${String(p.amount).padStart(5)}g  €${(p.price ?? 0).toFixed(2).padStart(7)}  ${p.name}`);
        console.log(`         ${(p.url ?? '').slice(0, 130)}`);
    }

    // Variation= URL coverage
    const hasVariation = enabled.filter((p) => /[?&]variation=\d/.test(p.url ?? ''));
    const noVariation = enabled.filter((p) => !/[?&]variation=\d/.test(p.url ?? ''));
    console.log('');
    console.log(`URL contains variation= param: ${hasVariation.length} / ${enabled.length}`);
    console.log(`URL has NO variation= param:   ${noVariation.length} / ${enabled.length}`);
    if (noVariation.length > 0 && noVariation.length <= 30) {
        console.log('No-variation products:');
        for (const p of noVariation) {
            console.log(`  ${p.id}  ${String(p.amount).padStart(5)}g  ${p.name}  ${p.url?.slice(0, 80)}`);
        }
    }
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Failed:', err);
    process.exit(1);
});
