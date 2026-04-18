import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { toggleFields } from '@/lib/product';

interface TogglesCardProps {
    form: Record<string, unknown>;
    setField: (key: string, value: unknown) => void;
}

export function TogglesCard({ form, setField }: TogglesCardProps) {
    return (
        <Card>
            <CardHeader><CardTitle>Toggles</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                {toggleFields.map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between">
                        <Label>{label}</Label>
                        <Switch checked={!!form[key]} onCheckedChange={(v) => setField(key, v)} />
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
