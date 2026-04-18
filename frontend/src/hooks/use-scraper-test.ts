import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Product, ScraperAction } from '@eiwittens/types';
import {
    testScraperStream, testScraperScreenshot, updateProduct,
    type ScraperEvent, type ScraperResultEvent,
} from '@/lib/api';
import { newActionId } from '@/lib/scraper';

export interface LogEntry {
    message: string;
    status: 'info' | 'success' | 'error' | 'ai';
}

export function useScraperTest(
    product: Product | undefined,
    id: string | undefined,
    actions: ScraperAction[],
    cookieXPaths: string[],
    setActions: React.Dispatch<React.SetStateAction<ScraperAction[]>>,
) {
    const queryClient = useQueryClient();

    const [screenshot, setScreenshot] = useState<string | null>(null);
    const [testing, setTesting] = useState(false);
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [activeActionIdx, setActiveActionIdx] = useState<number | null>(null);
    const [result, setResult] = useState<ScraperResultEvent | null>(null);
    const cancelRef = useRef<(() => void) | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logEntries]);

    const handleTest = () => {
        if (!product) return;
        setTesting(true);
        setResult(null);
        setLogEntries([]);
        setActiveActionIdx(null);

        const addLog = (message: string, status: LogEntry['status'] = 'info') => {
            setLogEntries((prev) => [...prev, { message, status }]);
        };

        const { cancel } = testScraperStream(
            product.url,
            actions,
            cookieXPaths.length > 0 ? cookieXPaths : undefined,
            (event: ScraperEvent) => {
                if (event.type === 'step') {
                    const d = event.data;
                    if (d.screenshot) setScreenshot(d.screenshot);

                    if (d.step === 'action') {
                        setActiveActionIdx(d.index ?? null);
                        addLog(d.message, 'info');
                    } else if (d.step === 'action_done') {
                        addLog(d.message, 'success');
                        setActiveActionIdx(null);
                    } else if (d.step === 'action_failed') {
                        addLog(d.message, 'error');
                        setActiveActionIdx(null);
                    } else if (d.step === 'ai_fixing') {
                        addLog(d.message, 'ai');
                    } else {
                        addLog(d.message, 'info');
                    }
                } else if (event.type === 'result') {
                    const r = event.data;
                    setResult(r);
                    if (r.screenshot) setScreenshot(r.screenshot);

                    if (r.aiFixed && r.fixedActions && r.fixedActions.length > 0) {
                        addLog('AI fix found! Saving updated actions...', 'ai');
                        const fixed = r.fixedActions.map((a) => ({ ...a, id: a.id || newActionId() }));
                        setActions(fixed);
                        updateProduct(id!, { scraper: fixed }).then(() => {
                            queryClient.invalidateQueries({ queryKey: ['product', id] });
                            addLog('AI-fixed actions saved', 'success');
                        }).catch(() => {
                            addLog('Failed to auto-save AI fix — click Save manually', 'error');
                        });
                    }

                    if (r.success) {
                        addLog(`Price: €${r.price.toFixed(2)}${r.aiFixed ? ' (AI fixed)' : ''}`, 'success');
                    } else {
                        addLog(r.error ?? 'Scraper test failed', 'error');
                    }

                    setTesting(false);
                }
            },
            (error: string) => {
                addLog(error, 'error');
                setTesting(false);
            },
        );

        cancelRef.current = cancel;
    };

    const handleCancelTest = () => {
        cancelRef.current?.();
        setTesting(false);
        setActiveActionIdx(null);
    };

    const handleScreenshot = async () => {
        if (!product) return;
        setTesting(true);
        try {
            const res = await testScraperScreenshot(product.url, cookieXPaths);
            if (res.screenshot) setScreenshot(res.screenshot);
        } catch {
            // pass
        } finally {
            setTesting(false);
        }
    };

    return {
        screenshot,
        setScreenshot,
        testing,
        logEntries,
        activeActionIdx,
        result,
        logEndRef,
        handleTest,
        handleCancelTest,
        handleScreenshot,
    };
}
