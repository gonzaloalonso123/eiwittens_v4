import type { ProductType, ScrapeTarget } from '@eiwittens/types';
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
    const scrapeTarget = (form.scrapeTarget ?? {}) as ScrapeTarget;

    const updateScrapeTarget = (patch: Partial<ScrapeTarget>) => {
        const next = { ...scrapeTarget, ...patch };
        const hasValue = Boolean(
            next.requiredTexts?.length
            || next.preferredOptionTexts?.length
            || next.rejectTexts?.length
            || next.notes?.trim(),
        );
        setField('scrapeTarget', hasValue ? next : undefined);
    };

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
                <div className="space-y-3 border-t pt-4">
                    <div className="space-y-2">
                        <Label>Required Scrape Texts</Label>
                        <Input
                            value={arrayToText(scrapeTarget.requiredTexts)}
                            onChange={(e) => updateScrapeTarget({ requiredTexts: textToArray(e.target.value) })}
                            placeholder="2kg, Vanilla"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Preferred Option Texts</Label>
                        <Input
                            value={arrayToText(scrapeTarget.preferredOptionTexts)}
                            onChange={(e) => updateScrapeTarget({ preferredOptionTexts: textToArray(e.target.value) })}
                            placeholder="2000 g, Vanille"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Rejected Scrape Texts</Label>
                        <Input
                            value={arrayToText(scrapeTarget.rejectTexts)}
                            onChange={(e) => updateScrapeTarget({ rejectTexts: textToArray(e.target.value) })}
                            placeholder="500g, sample"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Scrape Notes</Label>
                        <Input
                            value={scrapeTarget.notes ?? ''}
                            onChange={(e) => updateScrapeTarget({ notes: e.target.value || undefined })}
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function arrayToText(value: string[] | undefined): string {
    return value?.join(', ') ?? '';
}

function textToArray(value: string): string[] {
    return value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
}
