import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Save, Trash2, Settings } from 'lucide-react';

interface ProductDetailHeaderProps {
    id?: string;
    isNew: boolean;
    form: Record<string, unknown>;
    saving: boolean;
    onSave: () => void;
    onDelete: () => void;
}

export function ProductDetailHeader({ id, isNew, form, saving, onSave, onDelete }: ProductDetailHeaderProps) {
    return (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <Link to="/products">
                    <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
                </Link>
                <h1 className="text-2xl font-bold">{isNew ? 'New Product' : (form.name as string) || 'Edit Product'}</h1>
                {!isNew && (
                    <div className="flex gap-1">
                        {(form.warning as boolean) && <Badge variant="destructive">Warning</Badge>}
                        {form.provisional_price != null && <Badge variant="warning">Provisional: €{form.provisional_price as number}</Badge>}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-2">
                {!isNew && (
                    <Link to={`/products/${id}/scraper`}>
                        <Button variant="outline">
                            <Settings className="mr-2 h-4 w-4" />
                            Scraper
                        </Button>
                    </Link>
                )}
                {!isNew && (
                    <Button variant="destructive" size="sm" onClick={onDelete}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
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
