import 'dotenv/config';
import { db } from '../db/firebase.js';
import type { Product } from '@eiwittens/types';

const snap = await db.collection('products').get();
const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) })) as Product[];

const locked = all.filter((p) => p.manual_lock === true);
console.log(`Total products with manual_lock=true: ${locked.length}`);
console.log(`  enabled+locked:  ${locked.filter((p) => p.enabled).length}`);
console.log(`  disabled+locked: ${locked.filter((p) => !p.enabled).length}`);
console.log('');
console.log('All locked products:');
for (const p of locked) {
    console.log(`  ${p.id}  enabled=${p.enabled} scrape_enabled=${p.scrape_enabled} method=${p.extraction_method ?? 'playwright'}  ${p.store} — ${p.name}`);
}
process.exit(0);
