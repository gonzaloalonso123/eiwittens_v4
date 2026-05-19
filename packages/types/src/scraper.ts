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

export type ScraperAction = ClickAction | SelectOptionAction | SelectAction | WaitAction;

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
