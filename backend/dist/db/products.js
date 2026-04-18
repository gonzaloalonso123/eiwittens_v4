import { db } from './firebase.js';
const collection = db.collection('products');
function docToProduct(doc) {
    return { ...doc.data(), id: doc.id };
}
export async function getProducts() {
    const snapshot = await collection.get();
    return snapshot.docs.map(docToProduct);
}
export async function getEnabledScrapableProducts() {
    const all = await getProducts();
    return all.filter((p) => p.enabled && p.scrape_enabled);
}
export async function getProductById(id) {
    const doc = await collection.doc(id).get();
    if (!doc.exists)
        return null;
    return { ...doc.data(), id: doc.id };
}
export async function createProduct(data) {
    const ref = await collection.add(data);
    return { ...data, id: ref.id };
}
export async function updateProduct(id, data) {
    if (!id)
        throw new Error('Product ID is required for update');
    // Strip the id field — it lives in the document reference, not the data
    const { id: _id, ...updateData } = data;
    await collection.doc(id).update(updateData);
}
export async function deleteProduct(id) {
    if (!id)
        throw new Error('Product ID is required for delete');
    await collection.doc(id).delete();
}
//# sourceMappingURL=products.js.map