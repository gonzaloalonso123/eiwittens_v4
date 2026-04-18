import type { ScraperAction } from '@eiwittens/types';
import { ActionType, actionTypes } from '@eiwittens/types';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Plus } from 'lucide-react';
import { ActionItem } from './action-item';

interface ActionListProps {
    actions: ScraperAction[];
    selectedIdx: number | null;
    dragIdx: number | null;
    activeActionIdx: number | null;
    onSelect: (idx: number) => void;
    onAdd: (type: ActionType) => void;
    onRemove: (idx: number) => void;
    onDragStart: (idx: number) => void;
    onDragOver: (e: React.DragEvent, idx: number) => void;
    onDragEnd: () => void;
}

export function ActionList({
    actions, selectedIdx, dragIdx, activeActionIdx,
    onSelect, onAdd, onRemove, onDragStart, onDragOver, onDragEnd,
}: ActionListProps) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Actions ({actions.length})</CardTitle>
                    <div className="flex gap-1">
                        {actionTypes.map((at) => (
                            <Button key={at.value} variant="outline" size="sm" onClick={() => onAdd(at.value)}>
                                <Plus className="mr-1 h-3 w-3" />
                                {at.label}
                            </Button>
                        ))}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {actions.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">No actions yet. Add one above.</p>
                )}
                <div className="space-y-1">
                    {actions.map((action, idx) => (
                        <ActionItem
                            key={action.id}
                            action={action}
                            idx={idx}
                            isSelected={selectedIdx === idx}
                            isDragging={dragIdx === idx}
                            isActive={activeActionIdx === idx}
                            onSelect={() => onSelect(idx)}
                            onRemove={() => onRemove(idx)}
                            onDragStart={() => onDragStart(idx)}
                            onDragOver={(e) => onDragOver(e, idx)}
                            onDragEnd={onDragEnd}
                        />
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
