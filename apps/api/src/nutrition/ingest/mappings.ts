import { FoodCategory } from "@forjd/domain";

/**
 * Deterministic mapping tables for the USDA adapter, mirroring `exercises/ingest/mappings.ts`'s
 * own philosophy: **every lookup throws on a miss.** A silent default would let a re-vendor's
 * new category id be absorbed without anyone noticing, the same risk that file's own comment
 * names for equipment/muscle strings.
 *
 * Foundation and SR Legacy share one small (25-row) SR-legacy-style category taxonomy
 * (`food_category.csv`, id -> description). Survey (FNDDS) uses the much larger WWEIA taxonomy
 * (`wweia_food_category.csv`, a differently-named id column) -- 172 distinct ids appear across
 * the vendored Survey foods, measured directly against the pinned data (2026-08-31), far more
 * granular than the 8-bucket design needs. Two separate tables below, not one, because the two
 * id spaces are drawn from unrelated schemes and a collision between them (e.g. both having an
 * id "14") would otherwise be silently possible.
 *
 * **`'snacks'` is the deliberate catch-all**, not a random default: it is where SR Legacy's own
 * "Soups, Sauces, and Gravies", "Fast Foods", "Meals, Entrees, and Side Dishes" and "Baby Foods"
 * land, matching how the design's own prototype table already puts miscellaneous items like
 * Protein Bar and Dark Chocolate under Snacks rather than inventing a ninth bucket. It is also
 * `NutritionRepository`'s own `keepCategory` fallback, so an unusual value narrows the same way
 * at read time and at ingest time.
 */

/** Foundation + SR Legacy's shared `food_category.csv` id -> description -> `FoodCategory`. */
export const SR_LEGACY_CATEGORY_NAMES: Record<string, FoodCategory> = {
  "Dairy and Egg Products": "dairy",
  "Spices and Herbs": "snacks",
  "Baby Foods": "snacks",
  "Fats and Oils": "fats",
  "Poultry Products": "protein",
  "Soups, Sauces, and Gravies": "snacks",
  "Sausages and Luncheon Meats": "protein",
  "Breakfast Cereals": "grains",
  "Fruits and Fruit Juices": "fruits",
  "Pork Products": "protein",
  "Vegetables and Vegetable Products": "vegetables",
  "Nut and Seed Products": "snacks",
  "Beef Products": "protein",
  "Beverages": "beverages",
  "Finfish and Shellfish Products": "protein",
  "Legumes and Legume Products": "protein",
  "Lamb, Veal, and Game Products": "protein",
  "Baked Products": "grains",
  "Sweets": "snacks",
  "Cereal Grains and Pasta": "grains",
  "Fast Foods": "snacks",
  "Meals, Entrees, and Side Dishes": "snacks",
  "Snacks": "snacks",
  "American Indian/Alaska Native Foods": "snacks",
  "Restaurant Foods": "snacks",
};

/**
 * Survey's WWEIA `wweia_food_category` id -> `FoodCategory`, covering exactly the 172 ids
 * measured present in the vendored Survey foods (2026-08-31 pin). Grouped by WWEIA's own
 * leading-digit convention (1xxx dairy, 2xxx protein/meat/eggs, 4xxx grains, 6xxx
 * fruit/vegetable, 7xxx beverages, 8xxx fats/condiments/sugars, 9xxx baby/formula/misc) with
 * explicit per-id overrides where that convention alone would be wrong -- 3xxx ("mixed
 * dishes") has no single macro category, so each id is placed individually rather than bucketed
 * by prefix.
 */
export const WWEIA_CATEGORY_IDS: Record<string, FoodCategory> = {
  // 1xxx -- milk, cheese, yogurt, plant-based dairy substitutes.
  "1002": "dairy",
  "1004": "dairy",
  "1006": "dairy",
  "1008": "dairy",
  "1202": "dairy",
  "1204": "dairy",
  "1206": "dairy",
  "1208": "dairy",
  "1402": "dairy",
  "1602": "dairy",
  "1604": "dairy",
  "1820": "dairy",
  "1822": "dairy",
  "1902": "dairy",
  "1904": "dairy",
  // 2xxx -- meat, poultry, fish, eggs, legumes, nuts, soy.
  "2002": "protein",
  "2004": "protein",
  "2006": "protein",
  "2008": "protein",
  "2010": "protein",
  "2202": "protein",
  "2204": "protein",
  "2206": "protein",
  "2402": "protein",
  "2404": "protein",
  "2502": "protein",
  "2602": "protein",
  "2604": "protein",
  "2606": "protein",
  "2608": "protein",
  "2802": "protein",
  "2804": "snacks", // "Nuts and seeds" -- matches the design's own Almonds -> Snacks.
  "2806": "protein",
  // 3xxx -- mixed dishes. No macro-dominant bucket, so each id is placed on its own judgement.
  "3002": "protein",
  "3004": "protein",
  "3006": "protein",
  "3102": "vegetables",
  "3104": "vegetables",
  "3202": "grains",
  "3204": "grains",
  "3206": "grains",
  "3208": "grains",
  "3402": "grains",
  "3404": "snacks",
  "3406": "snacks",
  "3502": "snacks",
  "3504": "snacks",
  "3506": "snacks",
  "3602": "snacks",
  "3702": "snacks",
  "3703": "snacks",
  "3704": "snacks",
  "3706": "snacks",
  "3720": "snacks",
  "3722": "snacks",
  "3730": "snacks",
  "3740": "snacks",
  "3742": "snacks",
  "3744": "snacks",
  "3804": "snacks",
  "3806": "snacks",
  "3808": "snacks",
  // 4xxx -- grains, breads, cereals.
  "4002": "grains",
  "4004": "grains",
  "4202": "grains",
  "4204": "grains",
  "4206": "grains",
  "4208": "grains",
  "4402": "grains",
  "4404": "grains",
  "4602": "grains",
  "4604": "grains",
  "4802": "grains",
  "4804": "grains",
  // 5xxx -- salty snacks, sweets, bars, desserts.
  "5002": "snacks",
  "5004": "snacks",
  "5006": "snacks",
  "5008": "snacks",
  "5202": "snacks",
  "5204": "snacks",
  "5402": "snacks",
  "5404": "snacks",
  "5502": "snacks",
  "5504": "snacks",
  "5506": "snacks",
  "5702": "snacks",
  "5704": "snacks",
  "5802": "snacks",
  "5804": "snacks",
  "5806": "snacks",
  // 6xxx -- 60xx/61xx/62xx fruit, 64xx/68xx vegetables (including potatoes).
  "6002": "fruits",
  "6004": "fruits",
  "6006": "fruits",
  "6008": "fruits",
  "6009": "fruits",
  "6011": "fruits",
  "6012": "fruits",
  "6014": "fruits",
  "6016": "fruits",
  "6018": "fruits",
  "6020": "fruits",
  "6022": "fruits",
  "6024": "fruits",
  "6402": "vegetables",
  "6404": "vegetables",
  "6406": "vegetables",
  "6407": "vegetables",
  "6409": "vegetables",
  "6410": "vegetables",
  "6411": "vegetables",
  "6412": "vegetables",
  "6413": "vegetables",
  "6414": "vegetables",
  "6416": "vegetables",
  "6418": "vegetables",
  "6420": "vegetables",
  "6430": "vegetables",
  "6432": "vegetables",
  "6489": "vegetables",
  "6802": "vegetables",
  "6804": "vegetables",
  "6806": "vegetables",
  // 7xxx -- every liquid: juice, soda, coffee/tea, alcohol, water.
  "7002": "beverages",
  "7004": "beverages",
  "7006": "beverages",
  "7008": "beverages",
  "7102": "beverages",
  "7104": "beverages",
  "7106": "beverages",
  "7202": "beverages",
  "7204": "beverages",
  "7206": "beverages",
  "7208": "beverages",
  "7220": "beverages",
  "7302": "beverages",
  "7304": "beverages",
  "7502": "beverages",
  "7504": "beverages",
  "7506": "beverages",
  "7702": "beverages",
  "7704": "beverages",
  "7802": "beverages",
  "7804": "beverages",
  // 8xxx -- fats/oils/dairy-fat spreads, condiments (snacks catch-all), sugars (snacks catch-all).
  "8002": "fats",
  "8004": "fats",
  "8006": "fats",
  "8008": "fats",
  "8010": "fats",
  "8012": "fats",
  "8402": "snacks",
  "8404": "snacks",
  "8406": "snacks",
  "8408": "snacks",
  "8410": "snacks",
  "8412": "snacks",
  "8802": "snacks",
  "8804": "snacks",
  "8806": "snacks",
  // 9xxx -- baby food (misc, matches SR Legacy's own Baby Foods -> snacks), formula/baby
  // drinks (beverages), human milk (dairy), protein powder (protein).
  "9002": "snacks",
  "9004": "snacks",
  "9006": "snacks",
  "9007": "snacks",
  "9008": "snacks",
  "9010": "snacks",
  "9012": "snacks",
  "9202": "beverages",
  "9204": "beverages",
  "9402": "beverages",
  "9404": "beverages",
  "9602": "dairy",
  "9802": "protein",
  "9999": "snacks", // "Not included in a food category" -- the honest catch-all.
};

/**
 * Energy has three competing nutrient names, all KCAL (`SOURCE.md`'s trap 2, measured against
 * the pinned Foundation data: plain "Energy" alone covers only 135/469 foods (29%), the two
 * Atwater variants together cover 378/469 (81%)). Precedence order: prefer whichever is present
 * first, since a food only ever carries the values its release actually measured.
 */
export const KCAL_NUTRIENT_PRECEDENCE = [
  "Energy (Atwater General Factors)",
  "Energy (Atwater Specific Factors)",
  "Energy",
] as const;

export const PROTEIN_NUTRIENT_NAME = "Protein";
export const FAT_NUTRIENT_NAME = "Total lipid (fat)";
export const CARBS_NUTRIENT_NAME = "Carbohydrate, by difference";
