import { getProducts, updateProduct } from '../db/products.js';
import { scrapeProduct } from '../scraper/index.js';
import { ActionType, SelectorType } from '@eiwittens/types';
const TRUSTPILOT_BASE = 'https://www.trustpilot.com/review/';
const TRUSTPILOT_SCORE_XPATH = '//*[@id="business-unit-title"]/div/div/p';
const TRUSTPILOT_ACTION = {
    id: 'trustpilot-score',
    type: ActionType.Select,
    selectorType: SelectorType.Xpath,
    selectorValue: TRUSTPILOT_SCORE_XPATH,
};
export async function refreshTrustPilot() {
    const products = await getProducts();
    const withTrustpilot = products.filter((p) => p.trustpilot_url);
    // Deduplicate — multiple products may share the same merchant URL
    const scoreCache = new Map();
    for (const product of withTrustpilot) {
        const merchantUrl = product.trustpilot_url;
        if (!scoreCache.has(merchantUrl)) {
            console.log(`[trustpilot] Fetching score for ${merchantUrl}`);
            const syntheticProduct = {
                ...product,
                url: `${TRUSTPILOT_BASE}${merchantUrl}`,
                scraper: [TRUSTPILOT_ACTION],
                cookieBannerXPaths: [],
            };
            const { price: score } = await scrapeProduct(syntheticProduct);
            scoreCache.set(merchantUrl, score);
            console.log(`[trustpilot] ${merchantUrl} → ${score}`);
        }
    }
    let updated = 0;
    for (const product of withTrustpilot) {
        const score = scoreCache.get(product.trustpilot_url);
        if (score !== undefined && score > 0) {
            await updateProduct(product.id, { trustpilot_score: score });
            updated++;
        }
    }
    console.log(`[trustpilot] Updated ${updated} products`);
    return { updated };
}
//# sourceMappingURL=trustpilot.js.map