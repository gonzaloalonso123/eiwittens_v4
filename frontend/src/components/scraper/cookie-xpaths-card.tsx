import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Plus, Trash2 } from 'lucide-react';

interface CookieXPathsCardProps {
    cookieXPaths: string[];
    onAdd: () => void;
    onRemove: (idx: number) => void;
    onUpdate: (idx: number, value: string) => void;
}

export function CookieXPathsCard({ cookieXPaths, onAdd, onRemove, onUpdate }: CookieXPathsCardProps) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Cookie Banner XPaths</CardTitle>
                    <Button variant="outline" size="sm" onClick={onAdd}>
                        <Plus className="mr-1 h-3 w-3" /> Add
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-2">
                {cookieXPaths.length === 0 && (
                    <p className="text-sm text-muted-foreground">No cookie banner XPaths.</p>
                )}
                {cookieXPaths.map((xpath, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                        <Input
                            value={xpath}
                            onChange={(e) => onUpdate(idx, e.target.value)}
                            placeholder="//button[contains(text(),'Accept')]"
                            className="font-mono text-sm flex-1"
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
