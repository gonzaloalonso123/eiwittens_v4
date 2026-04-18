import { ActionType, SelectorType } from './enums.js';
interface BaseAction {
    id: string;
}
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
    duration?: number;
}
export type ScraperAction = ClickAction | SelectOptionAction | SelectAction | WaitAction;
export {};
//# sourceMappingURL=scraper.d.ts.map