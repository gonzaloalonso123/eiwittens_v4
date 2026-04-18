import type { LogEntry } from '@/hooks/use-scraper-test';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { CheckCircle, XCircle, Sparkles, Loader2 } from 'lucide-react';

interface TestLogProps {
    logEntries: LogEntry[];
    testing: boolean;
    logEndRef: React.RefObject<HTMLDivElement | null>;
}

export function TestLog({ logEntries, testing, logEndRef }: TestLogProps) {
    if (logEntries.length === 0) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Log</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-xs">
                    {logEntries.map((entry, idx) => {
                        const isLastInfo = entry.status === 'info' && testing && idx === logEntries.length - 1;
                        return (
                            <div key={idx} className="flex items-start gap-2">
                                {entry.status === 'success' && <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />}
                                {entry.status === 'error' && <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />}
                                {entry.status === 'ai' && <Sparkles className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" />}
                                {entry.status === 'info' && (
                                    isLastInfo
                                        ? <Loader2 className="h-3 w-3 text-primary animate-spin mt-0.5 shrink-0" />
                                        : <CheckCircle className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                                )}
                                <span className={entry.status === 'error' ? 'text-red-500' : entry.status === 'ai' ? 'text-yellow-600' : 'text-muted-foreground'}>
                                    {entry.message}
                                </span>
                            </div>
                        );
                    })}
                    <div ref={logEndRef} />
                </div>
            </CardContent>
        </Card>
    );
}
