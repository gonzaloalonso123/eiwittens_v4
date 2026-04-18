import { db } from './firebase.js';
import type { Product, ProductUpdate, ProductCreate } from '@eiwittens/types';

const collection = db.collection('products');

function docToProduct(doc: FirebaseFirestore.QueryDocumentSnapshot): Product {
    return { ...doc.data(), id: doc.id } as Product;
}

export async function getProducts(): Promise<Product[]> {
    const snapshot = await collection.get();
    return snapshot.docs.map(docToProduct);
}

export async function getEnabledScrapableProducts(): Promise<Product[]> {
    const all = await getProducts();
    return all.filter((p) => p.enabled && p.scrape_enabled);
}

export async function getProductById(id: string): Promise<Product | null> {
    const doc = await collection.doc(id).get();
    if (!doc.exists) return null;
    return { ...doc.data(), id: doc.id } as Product;
}

export async function createProduct(data: ProductCreate): Promise<Product> {
    const ref = await collection.add(data as Record<string, unknown>);
    return { ...data, id: ref.id } as Product;
}

export async function updateProduct(
    id: string,
    data: ProductUpdate | Product,
): Promise<void> {
    if (!id) throw new Error('Product ID is required for update');
    // Strip the id field — it lives in the document reference, not the data
    const { id: _id, ...updateData } = data as Product;
    await collection.doc(id).update(updateData as Record<string, unknown>);
}

export async function deleteProduct(id: string): Promise<void> {
    if (!id) throw new Error('Product ID is required for delete');
    await collection.doc(id).delete();
}
