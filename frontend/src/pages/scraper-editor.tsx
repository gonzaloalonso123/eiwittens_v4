import { useScraperActions } from '@/hooks/use-scraper-actions';
import { useScraperTest } from '@/hooks/use-scraper-test';
import { usePickElement } from '@/hooks/use-pick-element';
import { ScraperHeader } from '@/components/scraper/scraper-header';
import { ActionList } from '@/components/scraper/action-list';
import { ActionEditor } from '@/components/scraper/action-editor';
import { CookieXPathsCard } from '@/components/scraper/cookie-xpaths-card';
import { TestResultCard } from '@/components/scraper/test-result-card';
import { TestLog } from '@/components/scraper/test-log';
import { PagePreview } from '@/components/scraper/page-preview';

export function ScraperEditorPage() {
    const {
        id, product, isLoading,
        actions, setActions, cookieXPaths,
        saving, selectedIdx, setSelectedIdx, dragIdx, selected,
        handleSave, addAction, removeAction, updateAction, addPickedAction,
        handleDragStart, handleDragOver, handleDragEnd,
        addCookieXPath, removeCookieXPath, updateCookieXPath,
    } = useScraperActions();

    const {
        screenshot, testing, logEntries, activeActionIdx, result, logEndRef,
        handleTest, handleCancelTest, handleScreenshot,
    } = useScraperTest(product, id, actions, cookieXPaths, setActions);

    const {
        pickMode, picking, pickedElement, screenshotRef,
        handleScreenshotClick, togglePickMode, clearPickedElement,
    } = usePickElement(product, cookieXPaths);

    const handleAddPickedAction = (...args: Parameters<typeof addPickedAction>) => {
        addPickedAction(...args);
        clearPickedElement();
    };

    if (isLoading) {
        return <div className="py-12 text-center text-muted-foreground">Loading...</div>;
    }

    return (
        <div className="space-y-6">
            <ScraperHeader
                id={id}
                productName={product?.name}
                testing={testing}
                saving={saving}
                onScreenshot={handleScreenshot}
                onTest={handleTest}
                onCancelTest={handleCancelTest}
                onSave={handleSave}
            />

            <div className="grid gap-6 lg:grid-cols-2">
                {/* Left: Actions list + editor */}
                <div className="space-y-4">
                    <ActionList
                        actions={actions}
                        selectedIdx={selectedIdx}
                        dragIdx={dragIdx}
                        activeActionIdx={activeActionIdx}
                        onSelect={setSelectedIdx}
                        onAdd={addAction}
                        onRemove={removeAction}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDragEnd={handleDragEnd}
                    />

                    {selected && selectedIdx !== null && (
                        <ActionEditor
                            action={selected}
                            idx={selectedIdx}
                            onUpdate={updateAction}
                        />
                    )}

                    <CookieXPathsCard
                        cookieXPaths={cookieXPaths}
                        onAdd={addCookieXPath}
                        onRemove={removeCookieXPath}
                        onUpdate={updateCookieXPath}
                    />
                </div>

                {/* Right: Screenshot + test result + log */}
                <div className="space-y-4">
                    {result && <TestResultCard result={result} />}

                    <TestLog logEntries={logEntries} testing={testing} logEndRef={logEndRef} />

                    <PagePreview
                        screenshot={screenshot}
                        pickMode={pickMode}
                        picking={picking}
                        pickedElement={pickedElement}
                        screenshotRef={screenshotRef}
                        onTogglePickMode={togglePickMode}
                        onScreenshotClick={handleScreenshotClick}
                        onAddPickedAction={handleAddPickedAction}
                    />
                </div>
            </div>
        </div>
    );
}
