/**
 * Read the most recent scrape_runs from Firestore to diagnose why the
 * dashboard shows the scraper as "red". Read-only; writes nothing.
 *
 * Usage:
 *   pnpm tsx src/jobs/diagnose-scraper.ts
 */
import 'dotenv/config';
import { db } from '../db/firebase.js';

interface RunDoc {
    status?: string;
    startedAt?: { toDate?: () => Date } | Date;
    finishedAt?: { toDate?: () => Date } | Date | null;
    totalCount?: number;
    completedCount?: number;
    failedCount?: number;
    warningCount?: number;
    durationMs?: number;
    executionId?: string | null;
}

function toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && value !== null && 'toDate' in value) {
        const fn = (value as { toDate?: () => Date }).toDate;
        if (typeof fn === 'function') return fn.call(value);
    }
    return null;
}

function fmtDate(d: Date | null): string {
    return d ? d.toISOString().replace('T', ' ').slice(0, 19) : '—';
}

async function main(): Promise<void> {
    const snap = await db.collection('scrape_runs').orderBy('startedAt', 'desc').limit(10).get();
    if (snap.empty) {
        console.log('No scrape_runs found in Firestore.');
        return;
    }

    console.log(`\n=== Last ${snap.size} scrape runs ===\n`);
    for (const doc of snap.docs) {
        const data = doc.data() as RunDoc;
        const started = toDate(data.startedAt);
        const finished = toDate(data.finishedAt as unknown);
        const total = data.totalCount ?? 0;
        const completed = data.completedCount ?? 0;
        const failed = data.failedCount ?? 0;
        const warnings = data.warningCount ?? 0;
        const durationS = data.durationMs ? Math.round(data.durationMs / 1000) : 0;
        const ageMin = started ? Math.round((Date.now() - started.getTime()) / 60000) : -1;

        console.log(`Run: ${doc.id}`);
        console.log(`  status        : ${data.status ?? '(none)'}`);
        console.log(`  started       : ${fmtDate(started)} (${ageMin >= 0 ? `${ageMin} min ago` : 'unknown'})`);
        console.log(`  finished      : ${fmtDate(finished)}`);
        console.log(`  duration      : ${durationS}s`);
        console.log(`  totalCount    : ${total}`);
        console.log(`  completedCount: ${completed}`);
        console.log(`  failedCount   : ${failed}`);
        console.log(`  warningCount  : ${warnings}`);
        console.log(`  executionId   : ${data.executionId ?? '—'}`);
        console.log('');
    }

    const latest = snap.docs[0];
    const latestData = latest.data() as RunDoc;
    if (latestData.status === 'failed' || (latestData.failedCount ?? 0) > 0) {
        console.log(`\n=== Failed items in latest run (${latest.id}) — top 15 errors ===\n`);
        const itemsSnap = await latest.ref.collection('items').where('status', '==', 'failed').limit(15).get();
        for (const item of itemsSnap.docs) {
            const d = item.data();
            console.log(`- ${d.productId}: ${(d.error as string ?? '(no message)').slice(0, 200)}`);
        }
        if (itemsSnap.empty) {
            console.log('(no items in failed state in this run)');
        }
    }
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Diagnose failed:', err);
    process.exit(1);
});
