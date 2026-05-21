/**
 * Dump products that failed today's AI verification (both_failed verdict) so
 * they can be manually reviewed and hard-priced in the dashboard.
 *
 * Strategy: a product is "failed today" if it is enabled but has NO
 * ai_verified_at field set — those are the ones verify-with-ai couldn't
 * extract a price for via XPath, HTML AI, or vision.
 *
 * Output: a markdown file grouped by store with edit-link + URL per product.
 *
 * Usage:
 *   pnpm tsx src/jobs/dump-failed-products.ts <out-path>
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { db } from '../db/firebase.js';
import type { Product } from '@eiwittens/types';

const DASHBOARD_BASE = 'https://dashboard.gieriggroeien.nl/dashboard/products/edit/';

async function main(): Promise<void> {
    const outPath = process.argv[2];
    if (!outPath) {
        console.error('Usage: pnpm tsx src/jobs/dump-failed-products.ts <out-path>');
        process.exit(1);
    }

    const snap = await db.collection('products').get();
    const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) })) as Product[];

    // Failed = enabled + scrape-relevant (not free_*/feed_awin/vision_only) + no AI verification
    // AND has an implausible price (€0 or > €500). Products with a plausible price
    // are xpath_only cases where the scraper works even though AI couldn't validate —
    // they don't need manual hard-pricing.
    const candidates = all.filter((p) => {
        if (!p.enabled) return false;
        const m = p.extraction_method ?? 'playwright';
        if (m.startsWith('free_') || m === 'feed_awin' || m === 'vision_only') return false;
        return !p.ai_verified_at;
    });
    const failed = candidates.filter((p) => {
        const price = typeof p.price === 'number' ? p.price : 0;
        return !(price >= 2 && price <= 500); // implausible
    });
    const okButUnverified = candidates.filter((p) => {
        const price = typeof p.price === 'number' ? p.price : 0;
        return price >= 2 && price <= 500;
    });

    console.log(`Found ${candidates.length} enabled products without ai_verified_at`);
    console.log(`  ${failed.length} have implausible price (€0 or >€500) — likely truly broken`);
    console.log(`  ${okButUnverified.length} have a plausible price but failed AI validation — xpath_only cases, no urgent action`);

    const byStore = new Map<string, Product[]>();
    for (const p of failed) {
        const s = p.store ?? '(no store)';
        if (!byStore.has(s)) byStore.set(s, []);
        byStore.get(s)!.push(p);
    }
    const stores = Array.from(byStore.entries()).sort((a, b) => b[1].length - a[1].length);

    const lines: string[] = [];
    lines.push('# Failed AI Verification — Manual Hard-Price Candidates');
    lines.push('');
    lines.push(`_Generated ${new Date().toISOString()} — ${failed.length} products where today's verify-with-ai could not extract a price via XPath, HTML AI, OR vision._`);
    lines.push('');
    lines.push('Most are likely behind antibot (Cloudflare/DataDome 403) or use heavy JavaScript that none of our methods can read. For each:');
    lines.push('');
    lines.push('- ✅ Open the live URL in your browser, verify the product still exists');
    lines.push('- 💰 Note the current price');
    lines.push('- 🔧 Open the dashboard edit link, manually set the price (scrape_enabled=false + manual price)');
    lines.push('- ⛔️ If product is discontinued, set enabled=false');
    lines.push('');
    lines.push(`**Total: ${failed.length} products across ${stores.length} shops**`);
    lines.push('');

    for (const [storeName, prods] of stores) {
        lines.push(`## ${storeName} (${prods.length})`);
        lines.push('');
        for (const p of prods.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))) {
            const url = (p.url ?? '').replace(/\s/g, ' ');
            const editLink = `${DASHBOARD_BASE}${p.id}`;
            lines.push(`- [ ] **${p.name}** — ${p.amount}g — current €${(p.price ?? 0).toFixed(2)}`);
            lines.push(`  - Live: ${url}`);
            lines.push(`  - Edit: ${editLink}`);
        }
        lines.push('');
    }

    await writeFile(outPath, lines.join('\n'), 'utf-8');
    console.log(`Wrote ${failed.length} failed products to ${outPath}`);

    // Console summary
    console.log('\nPer-shop summary:');
    for (const [storeName, prods] of stores) {
        console.log(`  ${String(prods.length).padStart(3)} ${storeName}`);
    }
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Failed:', err);
    process.exit(1);
});
