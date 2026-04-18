import { useState, useRef } from 'react';
import type { Product } from '@eiwittens/types';
import { pickElement, type PickElementResult } from '@/lib/api';

export function usePickElement(product: Product | undefined, cookieXPaths: string[]) {
    const [pickMode, setPickMode] = useState(false);
    const [picking, setPicking] = useState(false);
    const [pickedElement, setPickedElement] = useState<PickElementResult | null>(null);
    const screenshotRef = useRef<HTMLImageElement>(null);

    const handleScreenshotClick = async (e: React.MouseEvent<HTMLImageElement>) => {
        if (!pickMode || !product || !screenshotRef.current) return;
        const img = screenshotRef.current;
        const rect = img.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 1920;
        const y = ((e.clientY - rect.top) / rect.height) * 1080;

        setPicking(true);
        setPickedElement(null);
        try {
            const result = await pickElement(
                product.url,
                x, y,
                cookieXPaths.length > 0 ? cookieXPaths : undefined,
            );
            setPickedElement(result);
        } catch {
            // pass
        } finally {
            setPicking(false);
        }
    };

    const togglePickMode = () => {
        setPickMode(!pickMode);
        setPickedElement(null);
    };

    const clearPickedElement = () => {
        setPickedElement(null);
        setPickMode(false);
    };

    return {
        pickMode,
        picking,
        pickedElement,
        screenshotRef,
        handleScreenshotClick,
        togglePickMode,
        clearPickedElement,
    };
}
