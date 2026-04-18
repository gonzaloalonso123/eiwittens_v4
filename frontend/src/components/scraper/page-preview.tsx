import { ActionType, SelectorType } from '@eiwittens/types';
import type { PickElementResult } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Crosshair, Loader2, MousePointer, Plus } from 'lucide-react';

interface PagePreviewProps {
    screenshot: string | null;
    pickMode: boolean;
    picking: boolean;
    pickedElement: PickElementResult | null;
    screenshotRef: React.RefObject<HTMLImageElement | null>;
    onTogglePickMode: () => void;
    onScreenshotClick: (e: React.MouseEvent<HTMLImageElement>) => void;
    onAddPickedAction: (type: ActionType, selectorType: SelectorType, selectorValue: string) => void;
}

export function PagePreview({
    screenshot, pickMode, picking, pickedElement, screenshotRef,
    onTogglePickMode, onScreenshotClick, onAddPickedAction,
}: PagePreviewProps) {
    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Page Preview</CardTitle>
                    {screenshot && (
                        <Button
                            variant={pickMode ? 'default' : 'outline'}
                            size="sm"
                            onClick={onTogglePickMode}
                        >
                            <Crosshair className="mr-1 h-3 w-3" />
                            {pickMode ? 'Cancel Pick' : 'Pick Element'}
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {screenshot ? (
                    <div className="relative">
                        <img
                            ref={screenshotRef}
                            src={`data:image/jpeg;base64,${screenshot}`}
                            alt="Page screenshot"
                            className={`w-full rounded-md border ${pickMode ? 'cursor-crosshair' : ''}`}
                            onClick={onScreenshotClick}
                        />
                        {picking && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-md">
                                <Loader2 className="h-6 w-6 animate-spin text-white" />
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-64 text-muted-foreground text-sm border rounded-md">
                        Click "Screenshot" or "Test Scraper" to preview the page
                    </div>
                )}

                {pickedElement && (
                    <div className="rounded-md border bg-muted/50 p-3 space-y-3">
                        <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                                <span className="font-medium">&lt;{pickedElement.tagName}&gt;</span>
                                {pickedElement.text && (
                                    <span className="ml-1">— "{pickedElement.text.slice(0, 80)}"</span>
                                )}
                            </p>
                            <div className="space-y-1 font-mono text-xs">
                                <p className="truncate"><span className="text-muted-foreground">CSS:</span> {pickedElement.css}</p>
                                <p className="truncate"><span className="text-muted-foreground">XPath:</span> {pickedElement.xpath}</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            <Button size="sm" variant="outline" onClick={() => onAddPickedAction(ActionType.Select, SelectorType.Css, pickedElement.css)}>
                                <Plus className="mr-1 h-3 w-3" /> Select (CSS)
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => onAddPickedAction(ActionType.Select, SelectorType.Xpath, pickedElement.xpath)}>
                                <Plus className="mr-1 h-3 w-3" /> Select (XPath)
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => onAddPickedAction(ActionType.Click, SelectorType.Css, pickedElement.css)}>
                                <MousePointer className="mr-1 h-3 w-3" /> Click (CSS)
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => onAddPickedAction(ActionType.Click, SelectorType.Xpath, pickedElement.xpath)}>
                                <MousePointer className="mr-1 h-3 w-3" /> Click (XPath)
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
