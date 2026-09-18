import { FoodCategory } from "@forjd/domain";

/**
 * Foods that are removed from the catalogue by name, before it is written to the snapshot.
 *
 * **This is the list to edit** when a food should not ship -- most often a US restaurant chain
 * that does not operate in Egypt, which would only take up search results and storage. The
 * pipeline re-applies it every time, so the removal survives a re-vendor, a migration or a fresh
 * deploy:
 *
 *   1. Add an entry below (a pattern anchored to the start of the name, and a short reason).
 *   2. Run `pnpm --filter @forjd/api nutrition:normalize` and review the diff in
 *      `data/removed-foods.json`.
 *   3. Merge. The deploy's `nutrition:load` then deletes those rows from the database
 *      (`NutritionRepository.pruneCatalogueFoods`).
 *
 * To bring a chain back, delete its entry and repeat -- an un-removed food is restored on load.
 *
 * Patterns are matched case-insensitively against the USDA description. Anchor them with `^` so a
 * chain's name inside an unrelated description does not remove it by accident. Add `category` to
 * apply a rule only within one food category -- the alcohol rules below are scoped to
 * `beverages`, so a word like "Gin" or "Rum" can never touch a food, infant formula or vinegar. A rule that
 * matches nothing in the snapshot fails `curate.spec.ts`, so a typo or a stale rule is caught.
 */
export interface FoodNameExclusion {
  readonly pattern: RegExp;
  /** When set, the rule only applies to foods of this category. */
  readonly category?: FoodCategory;
  /** Shown in `removed-foods.json` as `blocked: <reason>`. */
  readonly reason: string;
}

export const FOOD_NAME_EXCLUSIONS: readonly FoodNameExclusion[] = [
  // US chains with no Egyptian presence.
  { pattern: /^APPLEBEE'S,/i, reason: "Applebee's (not in Egypt)" },
  { pattern: /^DENNY'S,/i, reason: "Denny's (not in Egypt)" },
  { pattern: /^CRACKER BARREL,/i, reason: "Cracker Barrel (not in Egypt)" },
  { pattern: /^CARRABBA'S ITALIAN GRILL,/i, reason: "Carrabba's (not in Egypt)" },
  { pattern: /^OLIVE GARDEN,/i, reason: "Olive Garden (not in Egypt)" },
  { pattern: /^CHICK-FIL-A,/i, reason: "Chick-fil-A (not in Egypt)" },
  { pattern: /^ON THE BORDER,/i, reason: "On The Border (not in Egypt)" },
  { pattern: /^DIGIORNO /i, reason: "DiGiorno frozen pizza (US supermarket brand)" },
  { pattern: /^TACO BELL,/i, reason: "Taco Bell (not in Egypt)" },
  { pattern: /^ARBY'S,/i, reason: "Arby's (not in Egypt)" },
  { pattern: /^POPEYES,/i, reason: "Popeyes (removed by product decision)" },
  { pattern: /^LITTLE CAESARS /i, reason: "Little Caesars (removed by product decision)" },

  // US institutional and unbranded restaurant categories.
  { pattern: /^School Lunch,/i, reason: "US school lunch program" },
  { pattern: /, from school lunch/i, reason: "US school lunch program" },
  { pattern: /^Fast foods?,/i, reason: "generic US fast food" },
  { pattern: /^Restaurant,/i, reason: "generic US restaurant dish" },

  // Pork: only foods whose name contains the whole word "pork". Pepperoni, sausage, ham, bacon and
  // similar are kept even though many are pork, because the name alone does not say -- they can
  // equally be beef or poultry, and the dataset has no ingredient lists to tell them apart.
  { pattern: /\bpork\b/i, reason: "pork (the word appears in the name)" },

  // Alcoholic drinks. Scoped to `beverages`; non-alcoholic versions ("Beer, nonalcoholic", "Pina
  // Colada, nonalcoholic", "Whiskey sour mix") are deliberately kept. Foods that merely use alcohol
  // (rum balls, vodka sauce, cheese with wine) are not covered.
  {
    pattern:
      /^(Alcoholic |Beer\b(?!, nonalcoholic)|Wine\b(?!, nonalcoholic)|Hard cider|Brandy|Whiskey\b(?! sour mix)|Scotch\b|Gin\b|Rum\b|Vodka|Tequila|Liqueur|Bloody Mary|Daiquiri|Frozen (daiquiri|margarita)|Gelatin shot|Manhattan\b|Margarita\b(?! mix)|Martini|Mimosa|Mojito|Screwdriver|Tom Collins|Pina Colada\b(?!, nonalcoholic)|Sloe gin|Fruit punch, alcoholic|Champagne punch|Tequila Sunrise|Eggnog, alcoholic|Cocktail, NFS|Sangria|Beverages, (AMBER, )?hard cider|Beverages, Malt liquor)/i,
    category: "beverages",
    reason: "alcoholic drink",
  },
];
