import { productTypes } from '@eiwittens/types';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Table } from '@tanstack/react-table';
import type { Product } from '@eiwittens/types';

interface ProductFiltersProps {
    table: Table<Product>;
    globalFilter: string;
    setGlobalFilter: (value: string) => void;
    currentTypeFilter: string;
}

export function ProductFilters({ table, globalFilter, setGlobalFilter, currentTypeFilter }: ProductFiltersProps) {
    return (
        <div className="flex items-center gap-3">
            <Input
                placeholder="Search products..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="max-w-sm"
            />
            <Select
                value={currentTypeFilter}
                onValueChange={(v) => table.getColumn('type')?.setFilterValue(v === 'all' ? undefined : v)}
            >
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {productTypes.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                            {t.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
                {table.getFilteredRowModel().rows.length} products
            </span>
        </div>
    );
}
