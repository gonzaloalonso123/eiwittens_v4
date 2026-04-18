import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Camera, Play, Save, XCircle } from 'lucide-react';

interface ScraperHeaderProps {
    id?: string;
    productName?: string;
    testing: boolean;
    saving: boolean;
    onScreenshot: () => void;
    onTest: () => void;
    onCancelTest: () => void;
    onSave: () => void;
}

export function ScraperHeader({ id, productName, testing, saving, onScreenshot, onTest, onCancelTest, onSave }: ScraperHeaderProps) {
    return (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <Link to={`/products/${id}`}>
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
                </Link>
                <h1 className="text-2xl font-bold">Scraper — {productName}</h1>
            </div>
            <div className="flex items-center gap-2">
                <Button variant="outline" onClick={onScreenshot} disabled={testing}>
                    <Camera className="mr-2 h-4 w-4" />
                    Screenshot
                </Button>
                {testing ? (
                    <Button variant="outline" onClick={onCancelTest}>
                        <XCircle className="mr-2 h-4 w-4" />
                        Cancel
                    </Button>
                ) : (
                    <Button variant="outline" onClick={onTest}>
                        <Play className="mr-2 h-4 w-4" />
                        Test Scraper
                    </Button>
                )}
                <Button onClick={onSave} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saving...' : 'Save'}
                </Button>
            </div>
        </div>
    );
}
