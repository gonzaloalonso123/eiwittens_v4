import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';

chromium.use(StealthPlugin());

export interface DriverHandle {
    page: Page;
    cleanup: () => Promise<void>;
}

function getLaunchOptions(): Parameters<typeof chromium.launch>[0] {
    console.log(`[driver] platform=${process.platform}`);

    const launchOptions: Parameters<typeof chromium.launch>[0] = {
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

    return launchOptions;
}

export async function createBrowser(): Promise<Browser> {
    console.log(`[driver] Starting browser...`);
    try {
        const browser = await chromium.launch(getLaunchOptions());
        console.log(`[driver] Browser started successfully`);
        return browser;
    } catch (err) {
        console.error(`[driver] Failed to start browser:`, (err as Error).message);
        throw err;
    }
}

export async function createPage(browser: Browser): Promise<DriverHandle> {
    const context: BrowserContext = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'nl-NL',
        timezoneId: 'Europe/Amsterdam',
    });

    const page = await context.newPage();

    const cleanup = async (): Promise<void> => {
        console.log(`[driver] Cleaning up browser context`);
        try { await context.close(); } catch { /* ignore */ }
    };

    return { page, cleanup };
}

export async function createDriver(): Promise<DriverHandle> {
    const browser = await createBrowser();
    const handle = await createPage(browser);

    return {
        page: handle.page,
        cleanup: async () => {
            await handle.cleanup();
            console.log(`[driver] Cleaning up browser`);
            try { await browser.close(); } catch { /* ignore */ }
        },
    };
}

