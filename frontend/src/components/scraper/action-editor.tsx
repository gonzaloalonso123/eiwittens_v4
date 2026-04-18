import type { ScraperAction } from '@eiwittens/types';
import { ActionType, SelectorType, actionTypes } from '@eiwittens/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { defaultAction } from '@/lib/scraper';

interface ActionEditorProps {
    action: ScraperAction;
    idx: number;
    onUpdate: (idx: number, patch: Partial<ScraperAction>) => void;
}

export function ActionEditor({ action, idx, onUpdate }: ActionEditorProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Edit Action #{idx + 1}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>Type</Label>
                    <Select
                        value={action.type}
                        onValueChange={(v) => {
                            const newAct = defaultAction(v as ActionType);
                            onUpdate(idx, { ...newAct, id: action.id });
                        }}
                    >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {actionTypes.map((at) => (
                                <SelectItem key={at.value} value={at.value}>{at.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {action.type !== ActionType.Wait && (
                    <>
                        <div className="space-y-2">
                            <Label>Selector Type</Label>
                            <Select
                                value={(action as { selectorType: SelectorType }).selectorType}
                                onValueChange={(v) => onUpdate(idx, { selectorType: v as SelectorType } as Partial<ScraperAction>)}
                            >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={SelectorType.Css}>CSS</SelectItem>
                                    <SelectItem value={SelectorType.Xpath}>XPath</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Selector</Label>
                            <Input
                                value={(action as { selectorValue: string }).selectorValue}
                                onChange={(e) => onUpdate(idx, { selectorValue: e.target.value } as Partial<ScraperAction>)}
                                placeholder="e.g. .price-current or //span[@class='price']"
                                className="font-mono text-sm"
                            />
                        </div>
                    </>
                )}

                {action.type === ActionType.SelectOption && (
                    <div className="space-y-2">
                        <Label>Option Text</Label>
                        <Input
                            value={action.optionText}
                            onChange={(e) => onUpdate(idx, { optionText: e.target.value } as Partial<ScraperAction>)}
                            placeholder="Text of the option to select"
                        />
                    </div>
                )}

                {action.type === ActionType.Wait && (
                    <div className="space-y-2">
                        <Label>Duration (ms)</Label>
                        <Input
                            type="number"
                            value={action.duration ?? 2000}
                            onChange={(e) => onUpdate(idx, { duration: parseInt(e.target.value) || 2000 } as Partial<ScraperAction>)}
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
