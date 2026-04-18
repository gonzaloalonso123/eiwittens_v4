import type { ScraperAction } from '@eiwittens/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GripVertical, Loader2, Trash2 } from 'lucide-react';
import { actionLabel } from '@/lib/scraper';

interface ActionItemProps {
    action: ScraperAction;
    idx: number;
    isSelected: boolean;
    isDragging: boolean;
    isActive: boolean;
    onSelect: () => void;
    onRemove: () => void;
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragEnd: () => void;
}

export function ActionItem({
    action, idx, isSelected, isDragging, isActive,
    onSelect, onRemove, onDragStart, onDragOver, onDragEnd,
}: ActionItemProps) {
    return (
        <div
            draggable
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onClick={onSelect}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors ${isSelected ? 'border-primary bg-accent' : 'border-border hover:bg-muted'
                } ${isDragging ? 'opacity-50' : ''}`}
        >
            <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />
            {isActive && (
                <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
            )}
            <Badge variant="outline" className="shrink-0 text-xs">
                {action.type}
            </Badge>
            <span className="text-sm truncate flex-1">{actionLabel(action)}</span>
            <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
            >
                <Trash2 className="h-3 w-3" />
            </Button>
        </div>
    );
}
