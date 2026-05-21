// One-off fix: revert "ON Hydro Whey" store from Pure. back to BodySupplies.
// The Hydro Whey | pattern in apply-user-corrections.ts inadvertently matched
// "ON Hydro Whey" (Optimum Nutrition brand) and applied the Pure. rebrand.

import { db } from '../db/firebase.js';

const products = await db.collection('products').get();
let fixed = 0;
for (const doc of products.docs) {
    const data = doc.data() as { name?: string; store?: string };
    if (data.name?.toLowerCase().includes('on hydro whey') && data.store === 'Pure.') {
        await doc.ref.update({ store: 'BodySupplies' });
        console.log(`✓ Reverted: ${data.name} store: Pure. → BodySupplies (id=${doc.id})`);
        fixed++;
    }
}
console.log(`Done. ${fixed} fixed.`);
process.exit(0);
