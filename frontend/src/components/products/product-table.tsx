import { useNavigate } from 'react-router-dom';
import { flexRender, type Table, type ColumnDef } from '@tanstack/react-table';
import type { Product } from '@eiwittens/types';

interface ProductTableProps {
    table: Table<Product>;
    columns: ColumnDef<Product>[];
}

export function ProductTable({ table, columns }: ProductTableProps) {
    const navigate = useNavigate();

    return (
        <div className="rounded-md border">
            <table className="w-full">
                <thead>
                    {table.getHeaderGroups().map((hg) => (
                        <tr key={hg.id} className="border-b bg-muted/50">
                            {hg.headers.map((header) => (
                                <th key={header.id} className="px-4 py-3 text-left text-sm font-medium">
                                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody>
                    {table.getRowModel().rows.length === 0 ? (
                        <tr>
                            <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                                No products found.
                            </td>
                        </tr>
                    ) : (
                        table.getRowModel().rows.map((row) => (
                            <tr
                                key={row.id}
                                className="border-b cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => navigate(`/products/${row.original.id}`)}
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <td key={cell.id} className="px-4 py-3 text-sm">
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}
