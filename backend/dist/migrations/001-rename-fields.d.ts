/**
 * Migration 001: Rename fields to match new schema
 *
 * Changes:
 * - ammount → amount
 * - trustPilotScore → trustpilot_score
 * - discount_type: 'flat' → 'fixed'
 * - scraper[].selector → scraper[].selectorType
 * - scraper[].xpath → scraper[].selectorValue
 * - scraper[].id added (generated UUID)
 * - count_top10 → deleted
 * - New fields with defaults: store, out_of_stock, enabled_top10, only_in_store, ingredients, discount_code, subtypes, image
 *
 * Usage:
 *   pnpm --filter eiwittens-backend migrate
 *   DRY_RUN=true pnpm --filter eiwittens-backend migrate
 */
export {};
//# sourceMappingURL=001-rename-fields.d.ts.map