import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    type ColumnDef,
    type SortingState,
    type ColumnFiltersState,
} from '@tanstack/react-table';
import type { Product } from '@eiwittens/types';
import { fetchProducts } from '@/lib/api';
import { productColumns } from '@/components/products/columns';

export function useProductsTable() {
    const { data: products = [], isLoading } = useQuery({
        queryKey: ['products'],
        queryFn: fetchProducts,
    });

    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [globalFilter, setGlobalFilter] = useState('');

    const columns = useMemo<ColumnDef<Product>[]>(() => productColumns, []);

    const table = useReactTable({
        data: products,
        columns,
        state: { sorting, columnFilters, globalFilter },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        globalFilterFn: 'includesString',
    });

    const currentTypeFilter = (table.getColumn('type')?.getFilterValue() as string) ?? '';

    return {
        table,
        isLoading,
        globalFilter,
        setGlobalFilter,
        currentTypeFilter,
        columns,
    };
}
