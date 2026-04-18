import type { Product, ProductCreate, ProductUpdate, ScraperAction } from '@eiwittens/types';
import { auth } from '@/lib/firebase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

async function getHeaders(): Promise<HeadersInit> {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const user = auth.currentUser;
    if (user) {
        const token = await user.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = await getHeaders();
    const res = await fetch(`${API_URL}${path}`, { ...options, headers: { ...headers, ...options?.headers } });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed: ${res.status}`);
    }
    return res.json();
}

// ── Products ─────────────────────────────────────────────────────────────────

export function fetchProducts(): Promise<Product[]> {
    return request('/products');
}

export function fetchProduct(id: string): Promise<Product> {
    return request(`/products/${encodeURIComponent(id)}`);
}

export function createProduct(data: ProductCreate): Promise<Product> {
    return request('/products', { method: 'POST', body: JSON.stringify(data) });
}

export function updateProduct(id: string, data: ProductUpdate): Promise<Product> {
    return request(`/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteProduct(id: string): Promise<{ success: boolean }> {
    return request(`/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Scraper testing (SSE streaming) ──────────────────────────────────────────

export interface ScraperStepEvent {
    step: string;
    message: string;
    index?: number;
    action?: ScraperAction;
    screenshot?: string | null;
}

export interface ScraperResultEvent {
    success: boolean;
    price: number;
    screenshot: string | null;
    aiFixed: boolean;
    fixedActions?: ScraperAction[];
    message?: string;
    error?: string;
}

export type ScraperEvent =
    | { type: 'step'; data: ScraperStepEvent }
    | { type: 'result'; data: ScraperResultEvent };

/**
 * Stream scraper test via SSE. Calls `onEvent` for each step/result.
 * Returns a cancel function.
 */
export function testScraperStream(
    url: string,
    actions: ScraperAction[],
    cookieBannerXPaths: string[] | undefined,
    onEvent: (event: ScraperEvent) => void,
    onError: (error: string) => void,
): { cancel: () => void } {
    const controller = new AbortController();

    (async () => {
        try {
            const headers = await getHeaders();
            const res = await fetch(`${API_URL}/test-scraper`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ url, actions, cookieBannerXPaths }),
                signal: controller.signal,
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                onError(body.error || `Request failed: ${res.status}`);
                return;
            }

            const reader = res.body?.getReader();
            if (!reader) { onError('No response body'); return; }

            const decoder = new TextDecoder();
            let buffer = '';
            let currentEvent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE lines
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? ''; // keep incomplete line

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        currentEvent = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6);
                        try {
                            const data = JSON.parse(jsonStr);
                            if (currentEvent === 'step') {
                                onEvent({ type: 'step', data });
                            } else if (currentEvent === 'result') {
                                onEvent({ type: 'result', data });
                            }
                        } catch {
                            // skip malformed
                        }
                        currentEvent = '';
                    }
                }
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                onError(String(err));
            }
        }
    })();

    return { cancel: () => controller.abort() };
}

export function testScraperScreenshot(url: string, cookieBannerXPaths?: string[]): Promise<{ screenshot: string }> {
    return request('/test-scraper/screenshot', {
        method: 'POST',
        body: JSON.stringify({ url, cookieBannerXPaths }),
    });
}

export interface PickElementResult {
    text: string;
    tagName: string;
    css: string;
    xpath: string;
}

export function pickElement(url: string, x: number, y: number, cookieBannerXPaths?: string[]): Promise<PickElementResult> {
    return request('/test-scraper/pick-element', {
        method: 'POST',
        body: JSON.stringify({ url, x, y, cookieBannerXPaths }),
    });
}
