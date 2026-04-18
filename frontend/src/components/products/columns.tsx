import type { ColumnDef } from '@tanstack/react-table';
import type { Product } from '@eiwittens/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowUpDown } from 'lucide-react';
import { typeLabels } from '@/lib/product';

export const productColumns: ColumnDef<Product>[] = [
    {
        accessorKey: 'name',
        header: ({ column }) => (
            <Button variant="ghost" size="sm" onClick={() => column.toggleSorting()}>
                Name <ArrowUpDown className="ml-1 h-3 w-3" />
            </Button>
        ),
        cell: ({ row }) => (
            <div className="max-w-[240px] truncate font-medium">{row.getValue('name')}</div>
        ),
    },
    {
        accessorKey: 'store',
        header: 'Store',
        cell: ({ row }) => <span className="text-muted-foreground">{row.getValue('store') || '—'}</span>,
    },
    {
        accessorKey: 'type',
        header: 'Type',
        cell: ({ row }) => typeLabels[row.getValue('type') as string] ?? row.getValue('type'),
        filterFn: 'equals',
    },
    {
        accessorKey: 'price',
        header: ({ column }) => (
            <Button variant="ghost" size="sm" onClick={() => column.toggleSorting()}>
                Price <ArrowUpDown className="ml-1 h-3 w-3" />
            </Button>
        ),
        cell: ({ row }) => {
            const price = row.getValue('price') as number;
            return <span>€{Number(price).toFixed(2)}</span>;
        },
    },
    {
        accessorKey: 'price_for_element_gram',
        header: ({ column }) => (
            <Button variant="ghost" size="sm" onClick={() => column.toggleSorting()}>
                €/100g <ArrowUpDown className="ml-1 h-3 w-3" />
            </Button>
        ),
        cell: ({ row }) => {
            const val = row.getValue('price_for_element_gram') as number | undefined;
            return val ? `€${Number(val)?.toFixed(2)}` : '—';
        },
    },
    {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => {
            const p = row.original;
            return (
                <div className="flex flex-wrap gap-1">
                    {!p.enabled && <Badge variant="secondary">Disabled</Badge>}
                    {!p.scrape_enabled && <Badge variant="secondary">No scrape</Badge>}
                    {p.out_of_stock && <Badge variant="outline">Out of stock</Badge>}
                    {p.warning && <Badge variant="destructive">Warning</Badge>}
                    {p.provisional_price != null && <Badge variant="warning">Provisional</Badge>}
                </div>
            );
        },
    },
];
