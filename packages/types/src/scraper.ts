import { ActionType, SelectorType } from './enums.js';

// ── Base action (all actions carry a unique id for drag-and-drop reordering) ─

interface BaseAction {
    id: string;
}

// ── Action variants ─────────────────────────────────────────────────────────

export interface ClickAction extends BaseAction {
    type: ActionType.Click;
    selectorType: SelectorType;
    selectorValue: string;
}

/**
 * Click the first interactive element (button / link / label / role=button|radio)
 * whose visible text contains the given string (case-insensitive substring match).
 *
 * Use when a store uses variant-selector buttons that don't have stable IDs but
 * have predictable labels like "1kg", "500g", "Naturel". Common for Bulk and
 * Shopify-themed shops.
 */
export interface ClickByTextAction extends BaseAction {
    type: ActionType.ClickByText;
    /** Substring to match (case-insensitive) in element text. */
    text: string;
    /** Optional selector to scope the search. Defaults to buttons/links/labels. */
    scopeSelector?: string;
}

export interface SelectOptionAction extends BaseAction {
    type: ActionType.SelectOption;
    selectorType: SelectorType;
    selectorValue: string;
    optionText: string;
}

export interface SelectAction extends BaseAction {
    type: ActionType.Select;
    selectorType: SelectorType;
    selectorValue: string;
}

export interface WaitAction extends BaseAction {
    type: ActionType.Wait;
    duration?: number; // ms — defaults to 2000
}

export type ScraperAction = ClickAction | ClickByTextAction | SelectOptionAction | SelectAction | WaitAction;

export interface ScrapeTarget {
    requiredTexts?: string[];
    preferredOptionTexts?: string[];
    rejectTexts?: string[];
    notes?: string;
}

export type ScrapeConfidence = 'high' | 'medium' | 'low';

export interface ScrapeValidationResult {
    ok: boolean;
    confidence: ScrapeConfidence;
    score: number;
    reasons: string[];
    evidence: string[];
    missingRequiredTexts: string[];
    rejectedTexts: string[];
    price?: number;
}
