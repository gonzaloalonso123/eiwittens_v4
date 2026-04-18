import type { ProductType } from '@eiwittens/types';
import { productTypes, productSubtypes } from '@eiwittens/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface BasicInfoCardProps {
    form: Record<string, unknown>;
    setField: (key: string, value: unknown) => void;
}

export function BasicInfoCard({ form, setField }: BasicInfoCardProps) {
    const currentType = form.type as ProductType;
    const subtypesForType = productSubtypes[currentType] ?? [];

    return (
        <Card>
            <CardHeader><CardTitle>Product Info</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>Name</Label>
                    <Input value={(form.name as string) ?? ''} onChange={(e) => setField('name', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label>Store</Label>
                    <Input value={(form.store as string) ?? ''} onChange={(e) => setField('store', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label>URL</Label>
                    <Input value={(form.url as string) ?? ''} onChange={(e) => setField('url', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label>Image URL</Label>
                    <Input value={(form.image as string) ?? ''} onChange={(e) => setField('image', e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={currentType} onValueChange={(v) => { setField('type', v); setField('subtypes', []); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {productTypes.map((t) => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {subtypesForType.length > 0 && (
                    <div className="space-y-2">
                        <Label>Subtypes</Label>
                        <div className="flex flex-wrap gap-2">
                            {subtypesForType.map((st) => {
                                const selected = ((form.subtypes ?? []) as string[]).includes(st.value);
                                return (
                                    <Badge
                                        key={st.value}
                                        variant={selected ? 'default' : 'outline'}
                                        className="cursor-pointer"
                                        onClick={() => {
                                            const current = (form.subtypes ?? []) as string[];
                                            setField('subtypes', selected ? current.filter((s) => s !== st.value) : [...current, st.value]);
                                        }}
                                    >
                                        {st.label}
                                    </Badge>
                                );
                            })}
                        </div>
                    </div>
                )}
                <div className="space-y-2">
                    <Label>Amount (grams)</Label>
                    <Input
                        type="number"
                        value={(form.amount as number) ?? 0}
                        onChange={(e) => setField('amount', parseFloat(e.target.value) || 0)}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Dose (grams per serving)</Label>
                    <Input
                        type="number"
                        value={(form.dose as number) ?? ''}
                        onChange={(e) => setField('dose', parseFloat(e.target.value) || undefined)}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Trustpilot URL</Label>
                    <Input value={(form.trustpilot_url as string) ?? ''} onChange={(e) => setField('trustpilot_url', e.target.value || undefined)} />
                </div>
            </CardContent>
        </Card>
    );
}
