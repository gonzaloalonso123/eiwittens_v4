import type { ScraperResultEvent } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';

interface TestResultCardProps {
    result: ScraperResultEvent;
}

export function TestResultCard({ result }: TestResultCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    Test Result
                    {result.aiFixed && <Sparkles className="h-4 w-4 text-yellow-500" />}
                </CardTitle>
            </CardHeader>
            <CardContent>
                {result.success ? (
                    <div className="text-center py-4 space-y-2">
                        <p className="text-3xl font-bold">€{result.price.toFixed(2)}</p>
                        <Badge variant="default">
                            {result.aiFixed ? 'Fixed by AI' : 'Success'}
                        </Badge>
                    </div>
                ) : (
                    <div className="text-center py-4 space-y-2">
                        <Badge variant="destructive">Failed</Badge>
                        {result.error && (
                            <p className="text-sm text-muted-foreground mt-2">{result.error}</p>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
