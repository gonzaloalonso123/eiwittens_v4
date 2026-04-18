import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromium.use(StealthPlugin());
export async function createDriver() {
    console.log(`[driver] platform=${process.platform}`);
    const launchOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--window-size=1920,1080',
        ],
    };
    // Inside Docker on Linux, use the system Chromium installed by the Dockerfile
    if (process.platform === 'linux') {
        launchOptions.executablePath = '/usr/bin/chromium';
        console.log(`[driver] Linux detected — using system Chromium at /usr/bin/chromium`);
    }
    console.log(`[driver] Starting browser...`);
    let browser;
    try {
        browser = await chromium.launch(launchOptions);
    }
    catch (err) {
        console.error(`[driver] Failed to start browser:`, err.message);
        throw err;
    }
    console.log(`[driver] Browser started successfully`);
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'nl-NL',
        timezoneId: 'Europe/Amsterdam',
    });
    const page = await context.newPage();
    const cleanup = async () => {
        console.log(`[driver] Cleaning up browser`);
        try {
            await browser.close();
        }
        catch { /* ignore */ }
    };
    return { page, cleanup };
}
//# sourceMappingURL=driver.js.map