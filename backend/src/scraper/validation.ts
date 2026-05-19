import type { Page } from 'playwright';
import type { Product, ScrapeValidationResult } from '@eiwittens/types';

const MAX_VISIBLE_TEXT_CHARS = 60_000;
const HIGH_CONFIDENCE_SCORE = 80;
const MEDIUM_CONFIDENCE_SCORE = 55;

type ScrapeValidationContext = Pick<Product, 'name' | 'amount' | 'price' | 'scrapeTarget'>;

interface PageEvidence {
    visibleText: string;
    selectedTexts: string[];
}

export function normalizeText(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export function buildAmountHints(amount: number | undefined): string[] {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return [];

    const grams = formatNumber(amount);
    const hints = new Set<string>([
        `${grams}g`,
        `${grams} g`,
        `${grams}gr`,
        `${grams} gr`,
        `${grams} gram`,
    ]);

    if (amount >= 100) {
        const kg = amount / 1000;
        const dotKg = formatNumber(kg);
        const commaKg = dotKg.replace('.', ',');
        for (const value of new Set([dotKg, commaKg])) {
            hints.add(`${value}kg`);
            hints.add(`${value} kg`);
            hints.add(`${value} kilo`);
        }
    }

    return Array.from(hints);
}

export async function validateScrapeResult(
    page: Page,
    product: ScrapeValidationContext | undefined,
    price: number,
): Promise<ScrapeValidationResult> {
    const pageEvidence = await collectPageEvidence(page);
    const visibleText = normalizeText(pageEvidence.visibleText);
    const selectedText = normalizeText(pageEvidence.selectedTexts.join(' | '));
    const combinedText = `${visibleText} ${selectedText}`.trim();

    const requiredTexts = unique(product?.scrapeTarget?.requiredTexts ?? []);
    const preferredOptionTexts = unique(product?.scrapeTarget?.preferredOptionTexts ?? []);
    const rejectTexts = unique(product?.scrapeTarget?.rejectTexts ?? []);
    const amountHints = buildAmountHints(product?.amount);

    const reasons: string[] = [];
    const evidence: string[] = [];
    const missingRequiredTexts: string[] = [];
    const rejectedTexts: string[] = [];
    let score = 0;

    if (Number.isFinite(price) && price > 0) {
        score += 35;
        evidence.push(`Valid price extracted: €${price.toFixed(2)}`);
    } else {
        reasons.push(`Invalid price extracted: ${price}`);
    }

    if (requiredTexts.length === 0) {
        score += 15;
        reasons.push('No required scrape target texts configured');
    } else {
        for (const text of requiredTexts) {
            if (containsNormalized(combinedText, text)) {
                score += 12;
                evidence.push(`Required text found: ${text}`);
            } else {
                missingRequiredTexts.push(text);
                reasons.push(`Required text missing: ${text}`);
            }
        }
    }

    if (preferredOptionTexts.length > 0) {
        let preferredMatched = false;
        for (const text of preferredOptionTexts) {
            if (containsNormalized(selectedText, text)) {
                preferredMatched = true;
                score += 20;
                evidence.push(`Preferred option appears selected: ${text}`);
                break;
            }
            if (containsNormalized(visibleText, text)) {
                preferredMatched = true;
                score += 10;
                evidence.push(`Preferred option visible: ${text}`);
                break;
            }
        }
        if (!preferredMatched) {
            reasons.push(`No preferred option text matched: ${preferredOptionTexts.join(', ')}`);
        }
    }

    const matchedAmountHint = amountHints.find((hint) => containsNormalized(combinedText, hint));
    if (matchedAmountHint) {
        score += 15;
        evidence.push(`Amount hint found: ${matchedAmountHint}`);
    } else if (amountHints.length > 0) {
        reasons.push(`No amount hint found for ${product?.amount}g`);
    }

    for (const text of rejectTexts) {
        const selectedReject = containsNormalized(selectedText, text);
        const visibleReject = selectedText.length === 0 && containsNormalized(visibleText, text);
        if (selectedReject || visibleReject) {
            rejectedTexts.push(text);
            reasons.push(`Rejected text is present: ${text}`);
            score -= 35;
        }
    }

    const previousPrice = product?.price;
    if (isPositive(previousPrice) && isPositive(price)) {
        const ratio = price / previousPrice;
        if (ratio >= 0.45 && ratio <= 2.25) {
            score += 15;
            evidence.push(`Price is close to previous price: €${previousPrice.toFixed(2)}`);
        } else {
            score -= 20;
            reasons.push(`Price differs strongly from previous price: €${previousPrice.toFixed(2)} -> €${price.toFixed(2)}`);
        }
    } else if (isPositive(price)) {
        score += 10;
        reasons.push('No previous price available for sanity comparison');
    }

    const boundedScore = Math.max(0, Math.min(100, score));
    const confidence = boundedScore >= HIGH_CONFIDENCE_SCORE
        ? 'high'
        : boundedScore >= MEDIUM_CONFIDENCE_SCORE
            ? 'medium'
            : 'low';
    const ok = Number.isFinite(price)
        && price > 0
        && missingRequiredTexts.length === 0
        && rejectedTexts.length === 0
        && confidence !== 'low';

    if (!ok && reasons.length === 0) {
        reasons.push('Validation confidence is too low');
    }

    return {
        ok,
        confidence,
        score: boundedScore,
        reasons,
        evidence,
        missingRequiredTexts,
        rejectedTexts,
        price: Number.isFinite(price) ? price : undefined,
    };
}

export function isHighConfidenceValidation(validation: ScrapeValidationResult): boolean {
    return validation.ok && validation.confidence === 'high';
}

async function collectPageEvidence(page: Page): Promise<PageEvidence> {
    return page.evaluate((maxVisibleTextChars: number) => {
        const clean = (value: string | null | undefined): string => (
            value?.replace(/\s+/g, ' ').trim() ?? ''
        );
        const selectedTexts: string[] = [];

        for (const select of Array.from(document.querySelectorAll('select'))) {
            const selected = Array.from(select.selectedOptions)
                .map((option) => clean(option.textContent) || clean(option.value))
                .filter(Boolean);
            selectedTexts.push(...selected);
        }

        for (const input of Array.from(document.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked'))) {
            const label = input.id && typeof CSS !== 'undefined'
                ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
                : null;
            const text = clean(label?.textContent)
                || clean(input.closest('label')?.textContent)
                || clean(input.getAttribute('aria-label'))
                || clean(input.getAttribute('value'));
            if (text) selectedTexts.push(text);
        }

        const selectedLikeSelector = [
            '[aria-pressed="true"]',
            '[aria-selected="true"]',
            '[aria-current="true"]',
            '[data-selected="true"]',
            '.selected',
            '.active',
            '[class*="selected"]',
            '[class*="active"]',
        ].join(',');

        for (const el of Array.from(document.querySelectorAll(selectedLikeSelector)).slice(0, 80)) {
            const text = clean(el.textContent) || clean(el.getAttribute('aria-label')) || clean(el.getAttribute('title'));
            if (text) selectedTexts.push(text);
        }

        const visibleText = clean(document.body?.innerText).slice(0, maxVisibleTextChars);
        return {
            visibleText,
            selectedTexts: Array.from(new Set(selectedTexts)).slice(0, 80),
        };
    }, MAX_VISIBLE_TEXT_CHARS);
}

function containsNormalized(haystack: string, needle: string): boolean {
    const normalizedNeedle = normalizeText(needle);
    return normalizedNeedle.length > 0 && haystack.includes(normalizedNeedle);
}

function formatNumber(value: number): string {
    return Number.isInteger(value)
        ? String(value)
        : String(Number(value.toFixed(3))).replace(/\.0+$/, '');
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isPositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}