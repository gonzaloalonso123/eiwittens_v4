import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { computedFields } from '@/lib/product';

interface ComputedCardProps {
    form: Record<string, unknown>;
}

export function ComputedCard({ form }: ComputedCardProps) {
    return (
        <Card>
            <CardHeader><CardTitle>Computed Fields (read-only)</CardTitle></CardHeader>
            <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                    {computedFields(form).map(([label, value]) => (
                        <div key={label} className="flex justify-between border-b py-2 text-sm">
                            <span className="text-muted-foreground">{label}</span>
                            <span className="font-medium">{value}</span>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
