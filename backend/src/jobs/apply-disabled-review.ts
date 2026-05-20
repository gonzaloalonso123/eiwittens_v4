/**
 * Parse DISABLED-REVIEW.md and apply user's decisions to Firestore.
 *
 * Each product entry in the markdown looks like:
 *   - [ ] **Product Name** — 1000g — €0.00
 *     - id: `xxxxxx`
 *     - url: https://current/url
 *     - new url (only if current is dead): `<user annotation>`
 *
 * The `new url` field's contents drive the action:
 *   - "bestaat niet meer" (in any casing/trailing space)   → keep disabled
 *   - "is nog goed" / "nog goed" / "link is nog goed"      → re-enable only (no URL change)
 *   - starts with "http"                                   → update URL + re-enable
 *   - "-" or empty                                         → skip (not reviewed)
 *   - other                                                → flag for manual review
 *
 * Some entries also have a trailing parenthetical note after the URL like
 * "alleen nog in 189g versie" — these are surfaced as warnings; the URL is
 * still applied but the user must decide on the amount field separately.
 *
 * Usage:
 *   pnpm tsx src/jobs/apply-disabled-review.ts <path-to-md>             # dry-run
 *   pnpm tsx src/jobs/apply-disabled-review.ts <path-to-md> -- --apply  # write to Firestore
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { db } from '../db/firebase.js';

type Action = 'keep_disabled' | 're_enable' | 'update_url_and_re_enable' | 'skip' | 'manual_review';

interface ParsedEntry {
    id: string;
    name: string;
    currentUrl: string;
    newUrlRaw: string;
    newUrlClean: string | null;   // a real https:// URL if present, else null
    extraNote: string | null;     // any text after the URL backtick (e.g. "alleen 189g")
    newAmount: number | null;     // grams parsed from extraNote ("alleen 500g versie" → 500)
    action: Action;
    actionReason: string;
}

/** Parse "alleen nog in 189g versie" or "alleen in 500g" or "680g versie" → number of grams. */
function parseAmountFromNote(note: string | null): number | null {
    if (!note) return null;
    const m = note.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)/i);
    if (!m) return null;
    const value = parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(value)) return null;
    return m[2].toLowerCase() === 'kg' ? Math.round(value * 1000) : Math.round(value);
}

function parseFile(text: string): ParsedEntry[] {
    const lines = text.split('\n');
    const entries: ParsedEntry[] = [];

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        // Match a product header: "- [ ] **Name** — 1000g — €0.00"
        const headerMatch = line.match(/^- \[[ x!]\] \*\*(.+?)\*\* —/);
        if (!headerMatch) { i += 1; continue; }
        const name = headerMatch[1];

        // Look ahead for id, url, new url lines (next ~5 lines)
        let id = '';
        let currentUrl = '';
        let newUrlLine = '';
        for (let j = i + 1; j < Math.min(i + 8, lines.length); j += 1) {
            const sub = lines[j];
            if (/^- \[[ x!]\]/.test(sub)) break;   // hit next entry
            if (/^##/.test(sub)) break;            // hit next section

            const idMatch = sub.match(/^\s*-\s*id:\s*`([^`]+)`/);
            if (idMatch) id = idMatch[1];
            const urlMatch = sub.match(/^\s*-\s*url:\s*(.+)$/);
            if (urlMatch && !currentUrl) currentUrl = urlMatch[1].trim();
            const newUrlMatch = sub.match(/^\s*-\s*new url[^:]*:\s*(.+)$/i);
            if (newUrlMatch) newUrlLine = newUrlMatch[1].trim();
        }

        if (!id) { i += 1; continue; }

        // Extract the backtick-wrapped value from newUrlLine (and any trailing note)
        const backtickMatch = newUrlLine.match(/^`([^`]*)`\s*(.*)$/);
        const newUrlRaw = backtickMatch ? backtickMatch[1].trim() : newUrlLine.trim();
        const extraNote = backtickMatch && backtickMatch[2] ? backtickMatch[2].trim() : null;

        const normalized = newUrlRaw.toLowerCase().replace(/\s+/g, ' ').trim();
        let action: Action = 'manual_review';
        let actionReason = '';
        let newUrlClean: string | null = null;

        if (normalized === '' || normalized === '-') {
            action = 'skip';
            actionReason = 'not reviewed';
        } else if (normalized.includes('bestaat niet meer')) {
            action = 'keep_disabled';
            actionReason = 'URL dead per user';
        } else if (normalized.includes('nog goed') || normalized === 'is goed' || normalized.includes('werkt nog')) {
            action = 're_enable';
            actionReason = 'URL still valid per user';
        } else if (newUrlRaw.startsWith('http')) {
            newUrlClean = newUrlRaw;
            action = 'update_url_and_re_enable';
            actionReason = extraNote ? `URL update + note: ${extraNote}` : 'URL update';
        } else {
            action = 'manual_review';
            actionReason = `unrecognized: "${newUrlRaw.slice(0, 60)}"`;
        }

        const newAmount = parseAmountFromNote(extraNote);
        entries.push({ id, name, currentUrl, newUrlRaw, newUrlClean, extraNote, newAmount, action, actionReason });
        i += 1;
    }
    return entries;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const mdPath = args.find((a) => !a.startsWith('--') && a !== '');
    if (!mdPath) {
        console.error('Usage: pnpm tsx src/jobs/apply-disabled-review.ts <path-to-md> [-- --apply]');
        process.exit(1);
    }

    const text = readFileSync(mdPath, 'utf-8');
    const entries = parseFile(text);
    console.log(`[apply-disabled-review] Parsed ${entries.length} entries from ${mdPath}`);
    console.log(`[apply-disabled-review] Mode: ${apply ? 'APPLY (writes to Firestore)' : 'DRY RUN'}`);
    console.log('');

    const byAction: Record<Action, ParsedEntry[]> = {
        keep_disabled: [], re_enable: [], update_url_and_re_enable: [], skip: [], manual_review: [],
    };
    for (const e of entries) byAction[e.action].push(e);

    console.log('=== Plan summary ===');
    for (const [a, list] of Object.entries(byAction)) {
        console.log(`  ${a.padEnd(28)} ${list.length}`);
    }
    console.log('');

    // Optional: emit just the comma-separated list of IDs that would be re-enabled.
    // Useful for piping into verify-with-ai --product-ids ...
    if (args.includes('--emit-ids')) {
        const ids = [...byAction.re_enable, ...byAction.update_url_and_re_enable].map((e) => e.id);
        console.log(ids.join(','));
        return;
    }

    // Flag manual_review immediately — those need human attention
    if (byAction.manual_review.length > 0) {
        console.log('=== Manual review needed (unrecognized) ===');
        for (const e of byAction.manual_review) {
            console.log(`  ${e.id}  ${e.name}`);
            console.log(`    new url field: "${e.newUrlRaw}"`);
        }
        console.log('');
    }

    // Surface URL-update entries with notes for visibility
    const withNotes = byAction.update_url_and_re_enable.filter((e) => e.extraNote);
    if (withNotes.length > 0) {
        console.log('=== URL updates with extra notes (review amount/format) ===');
        for (const e of withNotes) {
            console.log(`  ${e.id}  ${e.name}`);
            console.log(`    new url: ${e.newUrlClean?.slice(0, 80)}...`);
            console.log(`    note: ${e.extraNote}`);
            if (e.newAmount !== null) {
                console.log(`    → will set amount=${e.newAmount}g`);
            } else {
                console.log(`    → no amount parsed; amount field unchanged`);
            }
        }
        console.log('');
    }

    // Apply writes
    if (!apply) {
        console.log('[apply-disabled-review] DRY RUN — pass --apply to write to Firestore');
        return;
    }

    let writes = 0;
    let errors = 0;
    const collection = db.collection('products');

    // 1. Re-enable: enabled=true (no URL change)
    for (const e of byAction.re_enable) {
        try {
            await collection.doc(e.id).update({ enabled: true });
            writes += 1;
            console.log(`  ✓ re-enable  ${e.id}  ${e.name}`);
        } catch (err) {
            errors += 1;
            console.error(`  ✗ ${e.id}: ${(err as Error).message}`);
        }
    }
    // 2. Update URL + re-enable (+ amount if note mentions a new size)
    for (const e of byAction.update_url_and_re_enable) {
        if (!e.newUrlClean) continue;
        try {
            const update: Record<string, unknown> = { enabled: true, url: e.newUrlClean };
            if (e.newAmount !== null) {
                update.amount = e.newAmount;
            }
            await collection.doc(e.id).update(update);
            writes += 1;
            const suffix = e.newAmount !== null
                ? ` (amount → ${e.newAmount}g, note: ${e.extraNote?.slice(0, 40)})`
                : (e.extraNote ? ` (note: ${e.extraNote.slice(0, 50)})` : '');
            console.log(`  ✓ url+enable ${e.id}  ${e.name}${suffix}`);
        } catch (err) {
            errors += 1;
            console.error(`  ✗ ${e.id}: ${(err as Error).message}`);
        }
    }
    // 3. keep_disabled / skip / manual_review: no writes
    console.log('');
    console.log(`[apply-disabled-review] Done. writes=${writes} errors=${errors}`);
    console.log(`[apply-disabled-review] After writes, run verify-with-ai with these IDs to extract prices + selectors.`);
}

main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error('Failed:', err);
    process.exit(1);
});
