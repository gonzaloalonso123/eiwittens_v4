import { Router } from 'express';
import { scrapeAndPush } from '../pipeline/index.js';
import { refreshTrustPilot } from '../jobs/trustpilot.js';
import { createBackup } from '../jobs/backup.js';
import { getProducts, getProductById, updateProduct, createProduct, deleteProduct } from '../db/products.js';
import { testScrapeWithProgress } from '../scraper/index.js';
import { pickElementAtPoint, takePageScreenshot } from '../scraper/picker.js';
import { requireAuth } from './auth.js';
import { asyncHandler } from '../lib/utils.js';
export const router = Router();
// ── Public routes ────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
router.get('/products', asyncHandler(async (_req, res) => {
    const products = await getProducts();
    res.json(products);
}));
// ── Protected routes ─────────────────────────────────────────────────────────
router.post('/scrape', requireAuth, asyncHandler(async (_req, res) => {
    const result = await scrapeAndPush();
    res.json(result);
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
    const id = req.params.id;
    const product = await getProductById(id);
    if (!product) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    res.json(product);
}));
router.post('/products', requireAuth, asyncHandler(async (req, res) => {
    const data = req.body;
    const product = await createProduct(data);
    res.status(201).json(product);
}));
router.put('/products/:id', requireAuth, asyncHandler(async (req, res) => {
    const id = req.params.id;
    const existing = await getProductById(id);
    if (!existing) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    // Whitelist of editable fields
    const allowed = [
        'name', 'store', 'url', 'image', 'type', 'subtypes',
        'enabled', 'scrape_enabled', 'out_of_stock', 'enabled_top10', 'only_in_store',
        'scraper', 'cookieBannerXPaths',
        'amount', 'dose',
        'protein_per_100g', 'creatine_per_100g', 'sugar_per_100g', 'calories_per_100g',
        'caffeine_per_100g', 'beta_alanine_per_100g', 'citrulline_per_100g', 'tyrosine_per_100g',
        'ingredients',
        'discount_type', 'discount_value', 'discount_code',
        'trustpilot_url',
        'price',
    ];
    const update = {};
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
    const id = req.params.id;
    const existing = await getProductById(id);
    if (!existing) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    await deleteProduct(id);
    res.json({ success: true });
}));
// ── Scraper testing (SSE streaming) ──────────────────────────────────────────
function sendSSE(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
router.post('/test-scraper', requireAuth, async (req, res) => {
    const { url, actions, cookieBannerXPaths } = req.body;
    if (!url || !Array.isArray(actions)) {
        res.status(400).json({ error: 'url and actions array are required' });
        return;
    }
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    await testScrapeWithProgress(url, actions, cookieBannerXPaths ?? [], (event) => {
        sendSSE(res, event.type, event.data);
    });
    res.end();
});
// Pick element: navigate, find element at coordinates, return selectors
router.post('/test-scraper/pick-element', requireAuth, asyncHandler(async (req, res) => {
    const { url, x, y, cookieBannerXPaths } = req.body;
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
    const { url, cookieBannerXPaths } = req.body;
    if (!url) {
        res.status(400).json({ error: 'url is required' });
        return;
    }
    const screenshot = await takePageScreenshot(url, cookieBannerXPaths ?? []);
    res.json({ screenshot });
}));
//# sourceMappingURL=routes.js.map