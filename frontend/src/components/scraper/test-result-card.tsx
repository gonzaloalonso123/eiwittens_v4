import type { ScraperResultEvent } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';

interface TestResultCardProps {
    result: ScraperResultEvent;
}

export function TestResultCard({ result }: TestResultCardProps) {
    const validation = result.validation;
    const validationVariant = validation?.confidence === 'high'
        ? 'default'
        : validation?.confidence === 'medium'
            ? 'warning'
            : 'destructive';
    const validationDetails = validation
        ? [...validation.evidence, ...validation.reasons].slice(0, 5)
        : [];

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    Test Result
                    {result.aiFixed && <Sparkles className="h-4 w-4 text-yellow-500" />}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
                        {!result.error && result.message && (
                            <p className="text-sm text-muted-foreground mt-2">{result.message}</p>
                        )}
                    </div>
                )}

                {validation && (
                    <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={validationVariant}>
                                {validation.confidence} confidence
                            </Badge>
                            <span className="text-muted-foreground">{validation.score}/100</span>
                        </div>
                        {validationDetails.length > 0 && (
                            <div className="space-y-1 text-left text-muted-foreground">
                                {validationDetails.map((detail) => (
                                    <p key={detail}>{detail}</p>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
