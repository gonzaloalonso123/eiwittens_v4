import type { ExtractionMethod } from '@eiwittens/types';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ExtractionCardProps {
    form: Record<string, unknown>;
    setField: (key: string, value: unknown) => void;
}

const METHODS: Array<{ value: ExtractionMethod; label: string; hint: string }> = [
    { value: 'playwright', label: 'Playwright + XPath (default)', hint: 'Current scraper: configured Click/Select actions + Claude Haiku AI fallback. Use for stores without structured data or with variant selection.' },
    { value: 'free_jsonld', label: 'Free — JSON-LD', hint: 'Schema.org Product offers from page HTML. No browser, no LLM. Use for stores with proper SEO schema (Bulk, Body&Fit, Mattisson).' },
    { value: 'free_shopify', label: 'Free — Shopify JSON', hint: 'Shopify /products/<handle>.json endpoint. Use for Shopify-based stores (BodyLab, ESN, 17Nutrition, GymQueen).' },
    { value: 'free_og', label: 'Free — OpenGraph meta', hint: 'OG product:price:amount meta tag. Use when JSON-LD missing but OG is present.' },
    { value: 'free_microdata', label: 'Free — Microdata', hint: 'Inline itemprop="price" attribute. Least reliable; use only as last resort.' },
    { value: 'feed_awin', label: 'Awin Feed (MyProtein)', hint: 'Price managed by daily Awin datafeed import. No live scraping. Use for products in approved feed-managed merchants.' },
];

export function ExtractionCard({ form, setField }: ExtractionCardProps) {
    const method = (form.extraction_method as ExtractionMethod) ?? 'playwright';
    const manualLock = form.manual_lock as boolean | undefined;
    const currentHint = METHODS.find((m) => m.value === method)?.hint ?? '';

    return (
        <Card>
            <CardHeader>
                <CardTitle>Extraction Strategy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>Extraction method</Label>
                    <Select
                        value={method}
                        onValueChange={(v) => setField('extraction_method', v === 'playwright' ? undefined : v)}
                    >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {METHODS.map((m) => (
                                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground leading-relaxed">{currentHint}</p>
                </div>

                <div className="flex items-center justify-between border-t pt-4">
                    <div className="space-y-1">
                        <Label>Manual lock</Label>
                        <p className="text-xs text-muted-foreground">
                            Block AI fallback from auto-overwriting `scraper` actions.
                            Use to protect manual XPath fixes.
                        </p>
                    </div>
                    <Switch
                        checked={!!manualLock}
                        onCheckedChange={(v) => setField('manual_lock', v || undefined)}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
