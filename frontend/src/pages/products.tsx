import { Link } from 'react-router-dom';
import { useProductsTable } from '@/hooks/use-products-table';
import { ProductFilters } from '@/components/products/product-filters';
import { ProductTable } from '@/components/products/product-table';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export function ProductsPage() {
    const { table, isLoading, globalFilter, setGlobalFilter, currentTypeFilter, columns } = useProductsTable();

    if (isLoading) {
        return <div className="py-12 text-center text-muted-foreground">Loading products...</div>;
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Products</h1>
                <Link to="/products/new">
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Product
                    </Button>
                </Link>
            </div>

            <ProductFilters
                table={table}
                globalFilter={globalFilter}
                setGlobalFilter={setGlobalFilter}
                currentTypeFilter={currentTypeFilter}
            />

            <ProductTable table={table} columns={columns} />
        </div>
    );
}
