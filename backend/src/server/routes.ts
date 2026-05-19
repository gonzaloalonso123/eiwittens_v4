import { Router } from 'express';
import type { Router as RouterType, Response } from 'express';
import { refreshTrustPilot } from '../jobs/trustpilot.js';
import { createBackup } from '../jobs/backup.js';
import { getProducts, getProductById, updateProduct, createProduct, deleteProduct } from '../db/products.js';
import { testScrapeWithProgress } from '../scraper/index.js';
import { pickElementAtPoint, takePageScreenshot } from '../scraper/picker.js';
import { requireAuth } from './auth.js';
import type { Product, ScraperAction, ProductCreate } from '@eiwittens/types';
import { asyncHandler, minimizeProducts } from '../lib/utils.js';

export const router: RouterType = Router();

// ── Public routes ────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/products', asyncHandler(async (req, res) => {
    const type = req.query.type as string;
    const products = await getProducts();
    if (type === 'MINIMAL') {
        res.json(minimizeProducts(products));
        return;
    }
    res.json(products);
}));

// ── Protected routes ─────────────────────────────────────────────────────────

router.post('/scrape', requireAuth, asyncHandler(async (_req, res) => {
    res.status(202).json({
        message: 'Scrapes now run through the daily-scrape-runner Cloud Run Job. Execute that job for manual runs.',
    });
}));

router.post('/trustpilot', requireAuth, asyncHandler(async (_req, res) => {
    const result = await refreshTrustPilot();
    res.json(result);
}));

router.post('/backup', requireAuth, asyncHandler(async (_req, res) => {
    const result = await createBackup();
    res.json(result);
}));

// ── Product CRUD ─────────────────────────────────────────────────────────────

router.get('/products/:id', asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const product = await getProductById(id);
    if (!product) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    res.json(product);
}));

router.post('/products', requireAuth, asyncHandler(async (req, res) => {
    const data = req.body as ProductCreate;
    const product = await createProduct(data);
    res.status(201).json(product);
}));

router.put('/products/:id', requireAuth, asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = await getProductById(id);
    if (!existing) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }

    // Whitelist of editable fields
    const allowed = [
        'name', 'store', 'url', 'image', 'type', 'subtypes',
        'enabled', 'scrape_enabled', 'out_of_stock', 'enabled_top10', 'only_in_store',
        'scraper', 'cookieBannerXPaths', 'scrapeTarget',
        'amount', 'dose',
        'protein_per_100g', 'creatine_per_100g', 'sugar_per_100g', 'calories_per_100g',
        'caffeine_per_100g', 'beta_alanine_per_100g', 'citrulline_per_100g', 'tyrosine_per_100g',
        'ingredients',
        'discount_type', 'discount_value', 'discount_code',
        'trustpilot_url',
        'price',
    ] as const;

    const update: Record<string, unknown> = {};
    for (const key of allowed) {
        if (key in req.body) {
            update[key] = req.body[key];
        }
    }

    await updateProduct(id, update);
    const updated = await getProductById(id);
    res.json(updated);
}));

router.delete('/products/:id', requireAuth, asyncHandler(async (req, res) => {
    const id = req.params.id as string;
    const existing = await getProductById(id);
    if (!existing) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    await deleteProduct(id);
    res.json({ success: true });
}));

// ── Scraper testing (SSE streaming) ──────────────────────────────────────────

function sendSSE(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.post('/test-scraper', requireAuth, async (req, res) => {
    const { url, actions, cookieBannerXPaths, product } = req.body as {
        url: string;
        actions: ScraperAction[];
        cookieBannerXPaths?: string[];
        product?: Product;
    };

    if (!url || !Array.isArray(actions)) {
        res.status(400).json({ error: 'url and actions array are required' });
        return;
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    await testScrapeWithProgress(product ?? url, actions, cookieBannerXPaths ?? [], (event) => {
        sendSSE(res, event.type, event.data);
    });

    res.end();
});

// Pick element: navigate, find element at coordinates, return selectors
router.post('/test-scraper/pick-element', requireAuth, asyncHandler(async (req, res) => {
    const { url, x, y, cookieBannerXPaths } = req.body as {
        url: string;
        x: number;
        y: number;
        cookieBannerXPaths?: string[];
    };

    if (!url || typeof x !== 'number' || typeof y !== 'number') {
        res.status(400).json({ error: 'url, x, and y are required' });
        return;
    }

    const result = await pickElementAtPoint(url, x, y, cookieBannerXPaths ?? []);
    if (!result) {
        res.status(404).json({ error: 'No element found at those coordinates' });
        return;
    }
    res.json(result);
}));

// Screenshot-only: navigate to URL and return screenshot (for initial page preview)
router.post('/test-scraper/screenshot', requireAuth, asyncHandler(async (req, res) => {
    const { url, cookieBannerXPaths } = req.body as {
        url: string;
        cookieBannerXPaths?: string[];
    };

    if (!url) {
        res.status(400).json({ error: 'url is required' });
        return;
    }

    const screenshot = await takePageScreenshot(url, cookieBannerXPaths ?? []);
    res.json({ screenshot });
}));
