import assert from 'node:assert/strict';
import { applyCalculations } from '../pipeline/calculations.js';
import { applyDiscounts } from '../pipeline/discounts.js';
import { applyWarnings, collectWarnings } from '../pipeline/warnings.js';
import { testProducts } from './product-fixtures.js';

function getProduct(id: string, products = testProducts) {
    const product = products.find((candidate) => candidate.id === id);
    assert.ok(product, `Missing fixture product: ${id}`);
    return product;
}

function runSuite(): void {
    assert.equal(testProducts.length, 10, 'The product test fixture should contain exactly 10 products');

    const warned = applyWarnings(testProducts);
    const warnings = collectWarnings(warned);

    assert.deepEqual(
        warnings.map((warning) => warning.productId),
        ['test-zero-price-warning'],
        'Only products with a missing/invalid price should be warning products',
    );
    assert.equal(
        getProduct('test-vitamins-zero-amount-valid-price', warned).warning,
        false,
        'A product with a valid scraped price and amount 0 should not be warning',
    );
    assert.equal(
        getProduct('test-food-zero-amount-valid-price', warned).warning,
        false,
        'A second amount 0 product guards against warning regressions across categories',
    );

    const discounted = applyDiscounts(warned);
    assert.equal(getProduct('test-percentage-discount', discounted).price, 18);
    assert.equal(getProduct('test-fixed-discount', discounted).price, 10);

    const calculated = applyCalculations(discounted);
    assert.equal(getProduct('test-protein-valid', calculated).price_for_element_gram, 3.56);
    assert.equal(getProduct('test-creatine-valid', calculated).price_for_element_gram, 3.6);
    assert.equal(getProduct('test-weight-gainer-valid', calculated).price_per_100_calories, 0.34);
    assert.equal(getProduct('test-weight-gainer-valid', calculated).price_per_1000_calories, 3.4);
    assert.equal(getProduct('test-preworkout-valid', calculated).price_per_dose, 1);
    assert.equal(
        getProduct('test-vitamins-zero-amount-valid-price', calculated).price_for_element_gram,
        undefined,
    );

    const calculatedFromStringAmount = applyCalculations([{
        ...getProduct('test-protein-valid'),
        amount: '900' as unknown as number,
    }]);
    assert.equal(
        calculatedFromStringAmount[0].price_for_element_gram,
        3.56,
        'Calculation should tolerate numeric string amount values read from legacy Firestore data',
    );

    const staleComputedRemoved = applyCalculations([{
        ...getProduct('test-vitamins-zero-amount-valid-price'),
        price_for_element_gram: 99,
        price_per_dose: 99,
    }]);
    assert.equal(staleComputedRemoved[0].price_for_element_gram, undefined);
    assert.equal(staleComputedRemoved[0].price_per_dose, undefined);
}

runSuite();
console.log('Product test suite passed: 10 fixtures, warning logic, discounts, and calculations are OK.');
