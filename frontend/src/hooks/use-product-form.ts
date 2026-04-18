import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProductCreate, Ingredient } from '@eiwittens/types';
import { fetchProduct, updateProduct, createProduct as apiCreateProduct, deleteProduct } from '@/lib/api';
import { emptyProduct } from '@/lib/product';

export function useProductForm() {
    const { id } = useParams<{ id: string }>();
    const isNew = !id;
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const { data: product, isLoading } = useQuery({
        queryKey: ['product', id],
        queryFn: () => fetchProduct(id!),
        enabled: !isNew,
    });

    const [form, setForm] = useState<Record<string, unknown>>(() => ({ ...emptyProduct }));
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (product) {
            setForm({ ...product });
        }
    }, [product]);

    const updateMutation = useMutation({
        mutationFn: (data: Record<string, unknown>) =>
            isNew
                ? apiCreateProduct(data as unknown as ProductCreate)
                : updateProduct(id!, data),
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            if (isNew && result?.id) {
                navigate(`/products/${result.id}`, { replace: true });
            }
        },
    });

    const deleteMutation = useMutation({
        mutationFn: () => deleteProduct(id!),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['products'] });
            navigate('/products', { replace: true });
        },
    });

    const setField = (key: string, value: unknown) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateMutation.mutateAsync(form);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this product?')) return;
        await deleteMutation.mutateAsync();
    };

    const ingredients = (form.ingredients ?? []) as Ingredient[];

    const addIngredient = () => setField('ingredients', [...ingredients, { name: '', amount: 0 }]);

    const removeIngredient = (idx: number) => setField('ingredients', ingredients.filter((_, i) => i !== idx));

    const updateIngredient = (idx: number, key: keyof Ingredient, value: string | number) => {
        const updated = [...ingredients];
        updated[idx] = { ...updated[idx], [key]: value };
        setField('ingredients', updated);
    };

    return {
        id,
        isNew,
        isLoading,
        form,
        saving,
        ingredients,
        setField,
        handleSave,
        handleDelete,
        addIngredient,
        removeIngredient,
        updateIngredient,
    };
}
