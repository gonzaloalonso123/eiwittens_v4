import { DiscountType, discountTypes } from '@eiwittens/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface PricingCardProps {
    form: Record<string, unknown>;
    setField: (key: string, value: unknown) => void;
}

export function PricingCard({ form, setField }: PricingCardProps) {
    const discountType = form.discount_type as DiscountType;

    return (
        <Card>
            <CardHeader><CardTitle>Pricing & Discounts</CardTitle></CardHeader>
            <CardContent className="space-y-4 max-w-lg">
                <div className="space-y-2">
                    <Label>Price (€)</Label>
                    <Input
                        type="number"
                        step="0.01"
                        value={(form.price as number) ?? 0}
                        onChange={(e) => setField('price', parseFloat(e.target.value) || 0)}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Discount Type</Label>
                    <Select value={discountType ?? DiscountType.None} onValueChange={(v) => setField('discount_type', v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {discountTypes.map((d) => (
                                <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {discountType && discountType !== DiscountType.None && (
                    <>
                        <div className="space-y-2">
                            <Label>Discount Value {discountType === DiscountType.Percentage ? '(%)' : '(€)'}</Label>
                            <Input
                                type="number"
                                step="0.01"
                                value={(form.discount_value as number) ?? ''}
                                onChange={(e) => setField('discount_value', parseFloat(e.target.value) || 0)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Discount Code</Label>
                            <Input
                                value={(form.discount_code as string) ?? ''}
                                onChange={(e) => setField('discount_code', e.target.value)}
                                placeholder="e.g. SAVE10"
                            />
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
