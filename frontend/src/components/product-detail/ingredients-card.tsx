import type { Ingredient } from '@eiwittens/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Trash2 } from 'lucide-react';

interface IngredientsCardProps {
    ingredients: Ingredient[];
    onAdd: () => void;
    onRemove: (idx: number) => void;
    onUpdate: (idx: number, key: keyof Ingredient, value: string | number) => void;
}

export function IngredientsCard({ ingredients, onAdd, onRemove, onUpdate }: IngredientsCardProps) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Ingredients</CardTitle>
                    <Button variant="outline" size="sm" onClick={onAdd}>Add</Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {ingredients.length === 0 && (
                    <p className="text-sm text-muted-foreground">No ingredients added.</p>
                )}
                {ingredients.map((ing, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                        <Input
                            placeholder="Name"
                            value={ing.name}
                            onChange={(e) => onUpdate(idx, 'name', e.target.value)}
                            className="flex-1"
                        />
                        <Input
                            type="number"
                            placeholder="Amount (mg)"
                            value={ing.amount || ''}
                            onChange={(e) => onUpdate(idx, 'amount', parseFloat(e.target.value) || 0)}
                            className="w-32"
                        />
                        <Button variant="ghost" size="icon" onClick={() => onRemove(idx)}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
