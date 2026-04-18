import type { ProductType } from '@eiwittens/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { nutritionFieldsByType, nutritionLabels } from '@/lib/product';

interface NutritionCardProps {
    form: Record<string, unknown>;
    setField: (key: string, value: unknown) => void;
}

export function NutritionCard({ form, setField }: NutritionCardProps) {
    const currentType = form.type as ProductType;
    const nutritionFields = nutritionFieldsByType[currentType] ?? [];

    return (
        <Card>
            <CardHeader><CardTitle>Nutritional Data (per 100g)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                {nutritionFields.length === 0 && (
                    <p className="text-sm text-muted-foreground">No nutritional fields for this product type.</p>
                )}
                {nutritionFields.map((field) => (
                    <div key={field} className="space-y-2">
                        <Label>{nutritionLabels[field] ?? field}</Label>
                        <Input
                            type="number"
                            step="0.01"
                            value={(form[field] as number) ?? ''}
                            onChange={(e) => setField(field, parseFloat(e.target.value) || undefined)}
                        />
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
