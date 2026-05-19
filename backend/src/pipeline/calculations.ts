import type { Product } from '@eiwittens/types';

export function applyCalculations(products: Product[]): Product[] {
    return products.map(calculateProduct);
}

function calculateProduct(product: Product): Product {
    const {
        price_for_element_gram: _priceForElementGram,
        price_per_dose: _pricePerDose,
        price_per_100_calories: _pricePer100Calories,
        price_per_1000_calories: _pricePer1000Calories,
        ...baseProduct
    } = product;
    const updates: Partial<Product> = {};

    switch (product.type) {
        case 'proteine':
            if (product.protein_per_100g) {
                const price = pricePerActiveGram(product, product.protein_per_100g);
                if (price !== undefined) updates.price_for_element_gram = price;
            }
            break;

        case 'creatine':
            if (product.creatine_per_100g) {
                const price = pricePerActiveGram(product, product.creatine_per_100g);
                if (price !== undefined) updates.price_for_element_gram = price;
            }
            break;

        case 'weight_gainer':
            if (product.protein_per_100g) {
                const price = pricePerActiveGram(product, product.protein_per_100g);
                if (price !== undefined) updates.price_for_element_gram = price;
            }
            if (product.calories_per_100g && product.amount && product.price) {
                updates.price_per_100_calories = pricePerHundredCalories(product);
                updates.price_per_1000_calories = parseFloat(
                    (pricePerHundredCalories(product) * 10).toFixed(2),
                );
            }
            break;

        case 'preworkout':
            if (product.dose && product.amount && product.price) {
                updates.price_per_dose = pricePerDose(product);
            }
            break;

        case 'preworkout_ingredient':
            // No computed metrics for individual ingredients
            break;
    }

    return { ...baseProduct, ...updates };
}

function pricePerActiveGram(product: Product, elementPer100g: number): number | undefined {
    if (!product.amount || !product.price) return undefined;
    const elementGrams = product.amount * (elementPer100g / 100);
    if (elementGrams === 0) return undefined;
    return parseFloat(((product.price / elementGrams) * 100).toFixed(2));
}

function pricePerDose(product: Product): number {
    const totalDoses = product.amount / product.dose!;
    return parseFloat((product.price / totalDoses).toFixed(2));
}

function pricePerHundredCalories(product: Product): number {
    const totalCalories = (product.calories_per_100g! * product.amount) / 100;
    return parseFloat(((product.price / totalCalories) * 100).toFixed(2));
}
