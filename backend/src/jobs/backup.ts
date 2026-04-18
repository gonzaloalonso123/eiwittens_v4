import fs from 'node:fs/promises';
import path from 'node:path';
import { getProducts } from '../db/products.js';

export interface BackupResult {
    path: string;
    productCount: number;
}

export async function createBackup(): Promise<BackupResult> {
    const products = await getProducts();
    const backupDir = path.resolve('./backup');
    const backupPath = path.join(backupDir, `products_backup_${Date.now()}.json`);

    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(backupPath, JSON.stringify(products, null, 2), 'utf-8');

    console.log(`[backup] Created ${backupPath} (${products.length} products)`);
    return { path: backupPath, productCount: products.length };
}
