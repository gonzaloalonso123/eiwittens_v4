import type { ScraperAction } from '@eiwittens/types';
import { ActionType, SelectorType } from '@eiwittens/types';

export function newActionId(): string {
    return crypto.randomUUID();
}

export function defaultAction(type: ActionType): ScraperAction {
    switch (type) {
        case ActionType.Click:
            return { id: newActionId(), type: ActionType.Click, selectorType: SelectorType.Css, selectorValue: '' };
        case ActionType.Select:
            return { id: newActionId(), type: ActionType.Select, selectorType: SelectorType.Css, selectorValue: '' };
        case ActionType.SelectOption:
            return { id: newActionId(), type: ActionType.SelectOption, selectorType: SelectorType.Css, selectorValue: '', optionText: '' };
        case ActionType.Wait:
            return { id: newActionId(), type: ActionType.Wait, duration: 2000 };
    }
}

export function actionLabel(action: ScraperAction): string {
    switch (action.type) {
        case ActionType.Click:
            return `Click — ${action.selectorValue || '(empty)'}`;
        case ActionType.Select:
            return `Select — ${action.selectorValue || '(empty)'}`;
        case ActionType.SelectOption:
            return `Select Option "${action.optionText || '...'}" — ${action.selectorValue || '(empty)'}`;
        case ActionType.Wait:
            return `Wait ${action.duration ?? 2000}ms`;
    }
}
