import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ScraperAction } from '@eiwittens/types';
import { ActionType, SelectorType } from '@eiwittens/types';
import { fetchProduct, updateProduct } from '@/lib/api';
import { newActionId, defaultAction } from '@/lib/scraper';

export function useScraperActions() {
    const { id } = useParams<{ id: string }>();
    const queryClient = useQueryClient();

    const { data: product, isLoading } = useQuery({
        queryKey: ['product', id],
        queryFn: () => fetchProduct(id!),
        enabled: !!id,
    });

    const [actions, setActions] = useState<ScraperAction[]>([]);
    const [cookieXPaths, setCookieXPaths] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
    const [dragIdx, setDragIdx] = useState<number | null>(null);

    useEffect(() => {
        if (product) {
            setActions((product.scraper ?? []).map((a) => ({ ...a, id: a.id || newActionId() })));
            setCookieXPaths(product.cookieBannerXPaths ?? []);
        }
    }, [product]);

    const saveMutation = useMutation({
        mutationFn: () => updateProduct(id!, { scraper: actions, cookieBannerXPaths: cookieXPaths }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['product', id] }),
    });

    const handleSave = async () => {
        setSaving(true);
        try { await saveMutation.mutateAsync(); } finally { setSaving(false); }
    };

    const addAction = (type: ActionType) => {
        const newAction = defaultAction(type);
        setActions((prev) => [...prev, newAction]);
        setSelectedIdx(actions.length);
    };

    const removeAction = (idx: number) => {
        setActions((prev) => prev.filter((_, i) => i !== idx));
        if (selectedIdx === idx) setSelectedIdx(null);
        else if (selectedIdx !== null && selectedIdx > idx) setSelectedIdx(selectedIdx - 1);
    };

    const updateAction = (idx: number, patch: Partial<ScraperAction>) => {
        setActions((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } as ScraperAction : a)));
    };

    const addPickedAction = (type: ActionType, selectorType: SelectorType, selectorValue: string) => {
        const action: ScraperAction = type === ActionType.Click
            ? { id: newActionId(), type: ActionType.Click, selectorType, selectorValue }
            : { id: newActionId(), type: ActionType.Select, selectorType, selectorValue };
        setActions((prev) => [...prev, action]);
        setSelectedIdx(actions.length);
    };

    // Drag reorder
    const handleDragStart = (idx: number) => setDragIdx(idx);
    const handleDragOver = (e: React.DragEvent, idx: number) => {
        e.preventDefault();
        if (dragIdx === null || dragIdx === idx) return;
        setActions((prev) => {
            const updated = [...prev];
            const [moved] = updated.splice(dragIdx, 1);
            updated.splice(idx, 0, moved);
            return updated;
        });
        setDragIdx(idx);
    };
    const handleDragEnd = () => setDragIdx(null);

    // Cookie XPaths
    const addCookieXPath = () => setCookieXPaths((prev) => [...prev, '']);
    const removeCookieXPath = (idx: number) => setCookieXPaths((prev) => prev.filter((_, i) => i !== idx));
    const updateCookieXPath = (idx: number, value: string) => setCookieXPaths((prev) => prev.map((v, i) => (i === idx ? value : v)));

    const selected = selectedIdx !== null ? actions[selectedIdx] : null;

    return {
        id,
        product,
        isLoading,
        actions,
        setActions,
        cookieXPaths,
        saving,
        selectedIdx,
        setSelectedIdx,
        dragIdx,
        selected,
        handleSave,
        addAction,
        removeAction,
        updateAction,
        addPickedAction,
        handleDragStart,
        handleDragOver,
        handleDragEnd,
        addCookieXPath,
        removeCookieXPath,
        updateCookieXPath,
    };
}
