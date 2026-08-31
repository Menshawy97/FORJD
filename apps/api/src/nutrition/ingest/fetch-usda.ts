import { mkdirSync } from "fs";
import { join } from "path";

import AdmZip from "adm-zip";

import { col, parseCsv, writeCsv } from "./csv";

/**
 * `pnpm --filter @forjd/api nutrition:fetch-usda`
 *
 * Phase A of the nutrition plan (`docs/product/nutrition-plan.md`, ADR-023): downloads USDA
 * FoodData Central's pinned bulk CSV releases for Foundation, SR Legacy and Survey (FNDDS),
 * and writes a **filtered** vendor snapshot under `data/`.
 *
 * **Filtered, not vendored verbatim -- unlike free-exercise-db (ADR-005).** The bulk release
 * is a full relational dump: 24 CSVs per release, most of it lab-sampling provenance never
 * read by this app. Committing it unfiltered would put ~57 MB of unused data in git history
 * permanently (measured 2026-08-31) to use ~14k rows and 4 nutrients of it. This script keeps
 * only what the design (`docs/design/nutrition-screen-specs.md`) ever displays -- kcal,
 * protein, carbs, fat -- and only real food rows, not the lab-metadata rows that share
 * `food.csv` with them.
 *
 * **No schema, no endpoints read this yet** -- matching exercises' own Phase A exactly
 * (`phase-2-plan.md`'s Phase A: "no schema, no endpoints -- nothing yet reads this file"). The
 * adapter and loader that read `data/` are Phase D's work, once Phase C's repository exists to
 * upsert into.
 *
 * A script, not a committed raw file, because the reduction (row + column filtering across
 * three joined tables) has to be reproducible and reviewable -- re-running it against a newer
 * USDA release should be "run this script, review the diff", the same guarantee
 * `exercises:normalize` gives the exercise catalogue.
 */

interface ReleaseSpec {
  /** Directory name under `data/`. */
  readonly dir: string;
  /** `food.csv`'s `data_type` value that marks a row as a real food in this release. */
  readonly dataType: string;
  readonly zipUrl: string;
  /**
   * The category lookup file this release's `food.csv.food_category_id` resolves against.
   * Foundation and SR Legacy share the same small (~25-row) SR-legacy-style taxonomy in
   * `food_category.csv`; Survey (FNDDS) uses the larger WWEIA taxonomy in
   * `wweia_food_category.csv`. Vendored now (Phase D), having been deliberately left out of
   * Phase A pending this decision (SOURCE.md).
   */
  readonly categoryFile: "food_category.csv" | "wweia_food_category.csv";
}

// Pinned 2026-08-31. Re-vendoring: update the URLs/dataType below to a newer release and
// re-run -- everything else in this script is release-agnostic. Record the new pin in
// data/SOURCE.md, the same discipline `exercises/ingest/data/SOURCE.md` documents.
const RELEASES: readonly ReleaseSpec[] = [
  {
    dir: "foundation",
    dataType: "foundation_food",
    zipUrl: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip",
    categoryFile: "food_category.csv",
  },
  {
    dir: "sr_legacy",
    dataType: "sr_legacy_food",
    zipUrl: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip",
    categoryFile: "food_category.csv",
  },
  {
    dir: "survey",
    dataType: "survey_fndds_food",
    zipUrl: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip",
    categoryFile: "wweia_food_category.csv",
  },
];

/**
 * Matched by **name**, not by a hardcoded nutrient id -- because `food_nutrient.nutrient_id`
 * carries a different identifier series depending on the release (see the module comment on
 * `resolveWantedNutrientIds`). The three Energy variants are kept because Foundation's own
 * data measures true: plain "Energy" (id 1008/nbr 208) alone covers only 135 of 469 Foundation
 * foods (29%), while the Atwater factor variants together cover 378 (81%) -- confirmed against
 * the FDC FAQ's own explanation that most energy values are Atwater-factor-derived. The
 * adapter (Phase D) picks a documented precedence among the three at read time; this script
 * only keeps all three so that choice is possible later.
 */
const WANTED_NUTRIENT_NAMES = [
  "Energy",
  "Energy (Atwater General Factors)",
  "Energy (Atwater Specific Factors)",
  "Protein",
  "Total lipid (fat)",
  "Carbohydrate, by difference",
] as const;

/**
 * Resolves the accepted `food_nutrient.nutrient_id` tokens for this release by looking the
 * wanted names up in **this release's own `nutrient.csv`**, and collecting both the `id` and
 * `nutrient_nbr` columns as acceptable matches.
 *
 * This is the fix for the trap `nutrition-plan.md` records: Foundation and SR Legacy's
 * `food_nutrient.nutrient_id` holds `nutrient.id` values (1008, 1003, ...), but Survey's holds
 * `nutrient.nbr` values (208, 203, ...) under the same column name. A hardcoded id set
 * measures Survey's macro coverage as zero. Matching by name and accepting either column
 * resolves correctly regardless of which scheme a given release's `food_nutrient.csv` uses,
 * without needing to special-case Survey.
 */
function resolveWantedNutrientIds(nutrientCsv: { header: string[]; rows: string[][] }): Set<string> {
  const idCol = col(nutrientCsv.header, "id");
  const nameCol = col(nutrientCsv.header, "name");
  const unitCol = col(nutrientCsv.header, "unit_name");
  const nbrCol = col(nutrientCsv.header, "nutrient_nbr");

  const wanted = new Set<string>(WANTED_NUTRIENT_NAMES);
  const ids = new Set<string>();

  for (const row of nutrientCsv.rows) {
    const name = row[nameCol] ?? "";
    const unit = row[unitCol] ?? "";
    const id = row[idCol] ?? "";
    const nbr = row[nbrCol] ?? "";

    // "Energy" alone is ambiguous between the KCAL and kJ rows (1008 vs 1062) -- keep only
    // KCAL, since that is the unit the whole nutrition feature stores and displays in
    // (ADR-023; kJ is a display-time conversion via ADR-016's energyUnit, not a second stored
    // value).
    if (name === "Energy" && unit !== "KCAL") continue;
    if (!wanted.has(name)) continue;
    if (id) ids.add(id);
    if (nbr) ids.add(nbr);
  }

  return ids;
}

function fetchZip(url: string): Promise<AdmZip> {
  return fetch(url).then(async (response) => {
    if (!response.ok) {
      throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return new AdmZip(buffer);
  });
}

function readEntry(zip: AdmZip, fileName: string): string {
  const entries = zip.getEntries();
  const entry = entries.find((candidate) => candidate.entryName.endsWith(`/${fileName}`));
  if (!entry) {
    throw new Error(`${fileName} not found in zip (entries: ${entries.map((entry) => entry.entryName).join(", ")})`);
  }
  return zip.readAsText(entry);
}

interface ReleaseCounts {
  foods: number;
  nutrientRows: number;
  portionRows: number;
}

async function processRelease(spec: ReleaseSpec, outDir: string): Promise<ReleaseCounts> {
  const zip = await fetchZip(spec.zipUrl);

  const food = parseCsv(readEntry(zip, "food.csv"));
  const foodNutrient = parseCsv(readEntry(zip, "food_nutrient.csv"));
  const foodPortion = parseCsv(readEntry(zip, "food_portion.csv"));
  const nutrient = parseCsv(readEntry(zip, "nutrient.csv"));
  const measureUnit = parseCsv(readEntry(zip, "measure_unit.csv"));
  const category = parseCsv(readEntry(zip, spec.categoryFile));

  const dataTypeCol = col(food.header, "data_type");
  const fdcIdCol = col(food.header, "fdc_id");
  const realFoodRows = food.rows.filter((row) => row[dataTypeCol] === spec.dataType);
  const realFoodIds = new Set(realFoodRows.map((row) => row[fdcIdCol]));

  const wantedNutrientIds = resolveWantedNutrientIds(nutrient);

  const fnFdcCol = col(foodNutrient.header, "fdc_id");
  const fnNutrientCol = col(foodNutrient.header, "nutrient_id");
  const fnAmountCol = col(foodNutrient.header, "amount");
  const nutrientRows = foodNutrient.rows.filter((row) => {
    const fdcId = row[fnFdcCol] ?? "";
    const nutrientId = row[fnNutrientCol] ?? "";
    return realFoodIds.has(fdcId) && wantedNutrientIds.has(nutrientId);
  });

  const fpFdcCol = col(foodPortion.header, "fdc_id");
  const portionRows = foodPortion.rows.filter((row) => realFoodIds.has(row[fpFdcCol] ?? ""));

  const dir = join(outDir, spec.dir);
  mkdirSync(dir, { recursive: true });

  writeCsv(join(dir, "food.csv"), food.header, realFoodRows);
  writeCsv(
    join(dir, "food_nutrient.csv"),
    ["fdc_id", "nutrient_id", "amount"],
    nutrientRows.map((row) => [row[fnFdcCol] ?? "", row[fnNutrientCol] ?? "", row[fnAmountCol] ?? ""]),
  );
  writeCsv(join(dir, "food_portion.csv"), foodPortion.header, portionRows);
  writeCsv(join(dir, "nutrient.csv"), nutrient.header, nutrient.rows);
  writeCsv(join(dir, "measure_unit.csv"), measureUnit.header, measureUnit.rows);
  writeCsv(join(dir, spec.categoryFile), category.header, category.rows);

  return { foods: realFoodRows.length, nutrientRows: nutrientRows.length, portionRows: portionRows.length };
}

async function main(): Promise<void> {
  const outDir = join(__dirname, "data");
  const summary: Record<string, ReleaseCounts> = {};

  for (const spec of RELEASES) {
    process.stdout.write(`fetching ${spec.dir} (${spec.zipUrl})...\n`);
    summary[spec.dir] = await processRelease(spec, outDir);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
