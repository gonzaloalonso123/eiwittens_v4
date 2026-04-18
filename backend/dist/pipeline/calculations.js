export function applyCalculations(products) {
    return products.map(calculateProduct);
}
function calculateProduct(product) {
    const updates = {};
    switch (product.type) {
        case 'proteine':
            if (product.protein_per_100g) {
                updates.price_for_element_gram = pricePerActiveGram(product, product.protein_per_100g);
            }
            break;
        case 'creatine':
            if (product.creatine_per_100g) {
                updates.price_for_element_gram = pricePerActiveGram(product, product.creatine_per_100g);
            }
            break;
        case 'weight_gainer':
            if (product.protein_per_100g) {
                updates.price_for_element_gram = pricePerActiveGram(product, product.protein_per_100g);
            }
            if (product.calories_per_100g && product.amount && product.price) {
                updates.price_per_100_calories = pricePerHundredCalories(product);
                updates.price_per_1000_calories = parseFloat((pricePerHundredCalories(product) * 10).toFixed(2));
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
    return { ...product, ...updates };
}
function pricePerActiveGram(product, elementPer100g) {
    const elementGrams = product.amount * (elementPer100g / 100);
    return parseFloat(((product.price / elementGrams) * 100).toFixed(2));
}
function pricePerDose(product) {
    const totalDoses = product.amount / product.dose;
    return parseFloat((product.price / totalDoses).toFixed(2));
}
function pricePerHundredCalories(product) {
    const totalCalories = (product.calories_per_100g * product.amount) / 100;
    return parseFloat(((product.price / totalCalories) * 100).toFixed(2));
}
//# sourceMappingURL=calculations.js.map