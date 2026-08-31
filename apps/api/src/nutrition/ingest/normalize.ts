import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { parseCsv } from "./csv";
import { UsdaFoodAdapter, UsdaReleaseInput } from "./usda-food.adapter";

/**
 * `pnpm --filter @forjd/api nutrition:normalize`
 *
 * Reads the vendored USDA CSVs (Phase A) and runs them through `UsdaFoodAdapter` (Phase D),
 * writing a checked-in snapshot of the normalized catalogue -- the same
 * vendor/normalize/load split `exercises/ingest/normalize.ts` established, for the same reason:
 * CI regenerates this file and runs `git diff --exit-code`, so a mapping-table change shows up
 * as a reviewable diff of the actual normalized foods rather than happening invisibly at load
 * time.
 *
 * This file and the adapter beside it are the only things in the repo that read the raw
 * vendored CSVs directly -- `scripts/ci/check-architecture-conformance.sh` enforces this.
 */

const INGEST_DIR = __dirname;
const DATA_DIR = join(INGEST_DIR, "data");
const SNAPSHOT_PATH = join(DATA_DIR, "normalized-foods.json");

const RELEASES: readonly { dir: string; categoryFile: string; categoryScheme: "sr_legacy" | "wweia" }[] = [
  { dir: "foundation", categoryFile: "food_category.csv", categoryScheme: "sr_legacy" },
  { dir: "sr_legacy", categoryFile: "food_category.csv", categoryScheme: "sr_legacy" },
  { dir: "survey", categoryFile: "wweia_food_category.csv", categoryScheme: "wweia" },
];

function readCsv(dir: string, fileName: string) {
  return parseCsv(readFileSync(join(DATA_DIR, dir, fileName), "utf8"));
}

function readRelease(spec: (typeof RELEASES)[number]): UsdaReleaseInput {
  return {
    food: readCsv(spec.dir, "food.csv"),
    foodNutrient: readCsv(spec.dir, "food_nutrient.csv"),
    foodPortion: readCsv(spec.dir, "food_portion.csv"),
    nutrient: readCsv(spec.dir, "nutrient.csv"),
    measureUnit: readCsv(spec.dir, "measure_unit.csv"),
    category: readCsv(spec.dir, spec.categoryFile),
    categoryScheme: spec.categoryScheme,
  };
}

export function normalize(): void {
  const releases = RELEASES.map(readRelease);
  const adapter = new UsdaFoodAdapter(releases);

  const foods = adapter
    .normalizeAll()
    // Sorted by sourceId so a re-vendor that merely reorders the upstream file produces no diff.
    .sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));

  const snapshot = {
    source: adapter.source,
    datasetPin: "see apps/api/src/nutrition/ingest/data/SOURCE.md",
    count: foods.length,
    foods,
  };

  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const tally = (): string =>
    Object.entries(
      foods.reduce<Record<string, number>>((counts, food) => {
        counts[food.category] = (counts[food.category] ?? 0) + 1;
        return counts;
      }, {}),
    )
      .sort(([, a], [, b]) => b - a)
      .map(([value, count]) => `${value} ${count}`)
      .join(", ");

  const noServings = foods.filter((food) => food.servings.length === 0).length;

  process.stdout.write(
    [
      `normalized ${foods.length} foods from ${adapter.source}`,
      `  category: ${tally()}`,
      `  foods with no servings (gram-only): ${noServings}`,
      `  -> ${SNAPSHOT_PATH}`,
      "",
    ].join("\n"),
  );
}

if (require.main === module) {
  normalize();
}
