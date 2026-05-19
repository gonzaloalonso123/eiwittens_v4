import { FieldValue } from 'firebase-admin/firestore';
import type { Product, ScrapeValidationResult } from '@eiwittens/types';
import { db } from './firebase.js';

export type ScrapeRunStatus = 'running' | 'succeeded' | 'completed_with_failures' | 'failed';
export type ScrapeRunItemStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ScrapeRunItem {
    status: ScrapeRunItemStatus;
    productId: string;
    startedAt?: Date;
    finishedAt?: Date;
    updatedAt?: Date;
    attempts: number;
    scrapedPrice?: number;
    aiUsed?: boolean;
    validation?: ScrapeValidationResult | null;
    error?: string | null;
    baselinePrice: number;
    baselineProduct: Product;
}

export interface CompletedScrapeRunItem extends ScrapeRunItem {
    status: 'completed';
    scrapedPrice: number;
    aiUsed: boolean;
    validation?: ScrapeValidationResult | null;
}

export interface FailedScrapeRunItem extends ScrapeRunItem {
    status: 'failed';
    error: string;
}

export interface ScrapeRunSummary {
    completedItems: CompletedScrapeRunItem[];
    failedItems: FailedScrapeRunItem[];
}

const runs = db.collection('scrape_runs');

function itemToData(product: Product): Omit<ScrapeRunItem, 'startedAt' | 'finishedAt' | 'updatedAt'> {
    return {
        status: 'pending',
        productId: product.id,
        attempts: 0,
        baselinePrice: product.price,
        baselineProduct: product,
        error: null,
    };
}

export function getScrapeRunId(): string {
    return process.env.CLOUD_RUN_EXECUTION || `local-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

export async function initializeScrapeRun(runId: string, products: Product[]): Promise<void> {
    const now = new Date();
    const runRef = runs.doc(runId);
    const runDoc = await runRef.get();

    if (!runDoc.exists) {
        await runRef.set({
            status: 'running',
            startedAt: now,
            finishedAt: null,
            totalCount: products.length,
            completedCount: 0,
            failedCount: 0,
            warningCount: 0,
            durationMs: 0,
            executionId: process.env.CLOUD_RUN_EXECUTION || null,
        });
    } else {
        await runRef.set({
            status: 'running',
            totalCount: products.length,
            executionId: process.env.CLOUD_RUN_EXECUTION || null,
        }, { merge: true });
    }

    const writer = db.bulkWriter();
    for (const product of products) {
        const itemRef = runRef.collection('items').doc(product.id);
        writer.create(itemRef, itemToData(product)).catch((err: unknown) => {
            if ((err as { code?: number }).code === 6) return;
            throw err;
        });
    }
    await writer.close();
}

export async function getRetryableRunItems(
    runId: string,
    staleAfterMs: number,
): Promise<ScrapeRunItem[]> {
    const snapshot = await runs.doc(runId).collection('items').get();
    const staleBefore = Date.now() - staleAfterMs;

    return snapshot.docs
        .map((doc) => doc.data() as ScrapeRunItem)
        .filter((item) => {
            if (item.status === 'pending' || item.status === 'failed') return true;
            if (item.status !== 'running') return false;
            const updatedAt = item.updatedAt instanceof Date
                ? item.updatedAt
                : (item.updatedAt as unknown as { toDate?: () => Date })?.toDate?.();
            return !updatedAt || updatedAt.getTime() < staleBefore;
        });
}

export async function markRunItemRunning(runId: string, productId: string): Promise<void> {
    const runRef = runs.doc(runId);
    const itemRef = runRef.collection('items').doc(productId);

    await db.runTransaction(async (transaction) => {
        const itemDoc = await transaction.get(itemRef);
        const previous = itemDoc.data() as ScrapeRunItem | undefined;

        transaction.set(itemRef, {
            status: 'running',
            startedAt: new Date(),
            updatedAt: new Date(),
            error: null,
            attempts: FieldValue.increment(1),
        }, { merge: true });

        if (previous?.status === 'failed') {
            transaction.set(runRef, {
                failedCount: FieldValue.increment(-1),
            }, { merge: true });
        }
    });
}

export async function markRunItemCompleted(
    runId: string,
    productId: string,
    scrapedPrice: number,
    aiUsed: boolean,
    validation?: ScrapeValidationResult,
): Promise<void> {
    const runRef = runs.doc(runId);
    const itemRef = runRef.collection('items').doc(productId);

    await db.runTransaction(async (transaction) => {
        const itemDoc = await transaction.get(itemRef);
        const previous = itemDoc.data() as ScrapeRunItem | undefined;

        transaction.set(itemRef, {
            status: 'completed',
            finishedAt: new Date(),
            updatedAt: new Date(),
            scrapedPrice,
            aiUsed,
            validation: validation ?? null,
            error: null,
        }, { merge: true });

        if (previous?.status !== 'completed') {
            transaction.set(runRef, {
                completedCount: FieldValue.increment(1),
            }, { merge: true });
        }
    });
}

export async function markRunItemFailed(runId: string, productId: string, error: string): Promise<void> {
    const runRef = runs.doc(runId);
    const itemRef = runRef.collection('items').doc(productId);

    await db.runTransaction(async (transaction) => {
        const itemDoc = await transaction.get(itemRef);
        const previous = itemDoc.data() as ScrapeRunItem | undefined;

        transaction.set(itemRef, {
            status: 'failed',
            finishedAt: new Date(),
            updatedAt: new Date(),
            error,
        }, { merge: true });

        if (previous?.status !== 'failed') {
            transaction.set(runRef, {
                failedCount: FieldValue.increment(1),
            }, { merge: true });
        }
    });
}

export async function summarizeScrapeRun(runId: string): Promise<ScrapeRunSummary> {
    const snapshot = await runs.doc(runId).collection('items').get();
    const items = snapshot.docs.map((doc) => doc.data() as ScrapeRunItem);

    return {
        completedItems: items.filter((item): item is CompletedScrapeRunItem => (
            item.status === 'completed' && typeof item.scrapedPrice === 'number'
        )),
        failedItems: items.filter((item): item is FailedScrapeRunItem => (
            item.status === 'failed' && typeof item.error === 'string'
        )),
    };
}

export async function finishScrapeRun(
    runId: string,
    status: ScrapeRunStatus,
    warningCount: number,
    durationMs: number,
): Promise<void> {
    const summary = await summarizeScrapeRun(runId);
    await runs.doc(runId).set({
        status,
        finishedAt: new Date(),
        completedCount: summary.completedItems.length,
        failedCount: summary.failedItems.length,
        warningCount,
        durationMs,
    }, { merge: true });
}
