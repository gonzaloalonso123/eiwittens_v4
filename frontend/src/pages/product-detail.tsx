import { useProductForm } from '@/hooks/use-product-form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProductDetailHeader } from '@/components/product-detail/product-detail-header';
import { BasicInfoCard } from '@/components/product-detail/basic-info-card';
import { TogglesCard } from '@/components/product-detail/toggles-card';
import { ExtractionCard } from '@/components/product-detail/extraction-card';
import { NutritionCard } from '@/components/product-detail/nutrition-card';
import { IngredientsCard } from '@/components/product-detail/ingredients-card';
import { PricingCard } from '@/components/product-detail/pricing-card';
import { ComputedCard } from '@/components/product-detail/computed-card';

export function ProductDetailPage() {
    const {
        id, isNew, isLoading, form, saving, ingredients,
        setField, handleSave, handleDelete,
        addIngredient, removeIngredient, updateIngredient,
    } = useProductForm();

    if (!isNew && isLoading) {
        return <div className="py-12 text-center text-muted-foreground">Loading...</div>;
    }

    return (
        <div className="space-y-6">
            <ProductDetailHeader
                id={id}
                isNew={isNew}
                form={form}
                saving={saving}
                onSave={handleSave}
                onDelete={handleDelete}
            />

            <Tabs defaultValue="basic">
                <TabsList>
                    <TabsTrigger value="basic">Basic</TabsTrigger>
                    <TabsTrigger value="nutrition">Nutrition</TabsTrigger>
                    <TabsTrigger value="pricing">Pricing</TabsTrigger>
                    {!isNew && <TabsTrigger value="computed">Computed</TabsTrigger>}
                </TabsList>

                <TabsContent value="basic">
                    <div className="grid gap-6 md:grid-cols-2">
                        <BasicInfoCard form={form} setField={setField} />
                        <div className="space-y-6">
                            <TogglesCard form={form} setField={setField} />
                            <ExtractionCard form={form} setField={setField} />
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="nutrition">
                    <div className="grid gap-6 md:grid-cols-2">
                        <NutritionCard form={form} setField={setField} />
                        <IngredientsCard
                            ingredients={ingredients}
                            onAdd={addIngredient}
                            onRemove={removeIngredient}
                            onUpdate={updateIngredient}
                        />
                    </div>
                </TabsContent>

                <TabsContent value="pricing">
                    <PricingCard form={form} setField={setField} />
                </TabsContent>

                {!isNew && (
                    <TabsContent value="computed">
                        <ComputedCard form={form} />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}
