/**
 * Migration 002: Coerce field types to match Product interface
 *
 * Firestore may store numbers as strings, booleans as strings, etc.
 * This migration ensures all fields match the expected TypeScript types.
 *
 * Usage:
 *   npx tsx src/migrations/002-coerce-types.ts
 *   DRY_RUN=true npx tsx src/migrations/002-coerce-types.ts
 */
export {};
//# sourceMappingURL=002-coerce-types.d.ts.map