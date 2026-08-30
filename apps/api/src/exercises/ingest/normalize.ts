import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { ExerciseOverrides } from "./exercise-source-adapter.interface";
import { FreeExerciseDbAdapter, FreeExerciseDbRow } from "./free-exercise-db.adapter";

/**
 * `pnpm --filter @forjd/api exercises:normalize`
 *
 * Reads the vendored dataset and the override file, runs them through the adapter, and writes
 * a checked-in snapshot of the normalized catalogue.
 *
 * The snapshot is the point of this phase. CI regenerates it and runs `git diff --exit-code`
 * (the same gate `packages/contracts` fixtures already use), so changing a mapping table or an
 * override shows up as a reviewable diff of the actual normalized records -- 873 of them, each
 * with its category, goal and measure -- rather than happening invisibly inside a deploy. A
 * one-word edit to a mapping table that silently reclassifies 122 exercises is exactly the kind
 * of change that should be impossible to merge without seeing it.
 *
 * This file and the adapter beside it are the only things in the repo that read the raw
 * dataset, which `scripts/ci/check-architecture-conformance.sh` enforces.
 */

const INGEST_DIR = __dirname;
const DATASET_PATH = join(INGEST_DIR, "data", "free-exercise-db.json");
const SNAPSHOT_PATH = join(INGEST_DIR, "data", "normalized-exercises.json");
const OVERRIDES_PATH = join(
  INGEST_DIR,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "domain",
  "data",
  "exercise-overrides.json",
);

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

export function normalize(): void {
  const rows = readJson<FreeExerciseDbRow[]>(DATASET_PATH);
  // The casts above are assertions about a file on disk. These two checks are the cheapest
  // possible backstop for the shapes the adapter cannot check for itself: without them a
  // renamed `overrides` key surfaces as "Cannot convert undefined or null to object" rather
  // than as the thing that actually went wrong.
  if (!Array.isArray(rows)) {
    throw new Error(`${DATASET_PATH} did not parse to an array of exercises.`);
  }
  const parsedOverrides = readJson<{ overrides?: ExerciseOverrides }>(OVERRIDES_PATH);
  const overrides = parsedOverrides.overrides;
  if (overrides === undefined || typeof overrides !== "object") {
    throw new Error(`${OVERRIDES_PATH} has no "overrides" object at its top level.`);
  }

  const adapter = new FreeExerciseDbAdapter(rows, overrides);
  const exercises = adapter
    .normalizeAll()
    // Sorted by sourceId rather than left in source order, so a re-vendor that merely reorders
    // the upstream file produces no diff here. Only real content changes show up.
    .sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));

  const snapshot = {
    // Written into the file so the snapshot records which inputs produced it, rather than
    // relying on whoever reads the diff to go and check.
    source: adapter.source,
    datasetPin: "see apps/api/src/exercises/ingest/data/SOURCE.md",
    count: exercises.length,
    exercises,
  };

  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const tally = (key: "category" | "goal" | "measure"): string =>
    Object.entries(
      exercises.reduce<Record<string, number>>((counts, exercise) => {
        counts[exercise[key]] = (counts[exercise[key]] ?? 0) + 1;
        return counts;
      }, {}),
    )
      .sort(([, a], [, b]) => b - a)
      .map(([value, count]) => `${value} ${count}`)
      .join(", ");

  process.stdout.write(
    [
      `normalized ${exercises.length} exercises from ${adapter.source}`,
      `  category: ${tally("category")}`,
      `  goal:     ${tally("goal")}`,
      `  measure:  ${tally("measure")}`,
      `  overrides applied: ${Object.keys(overrides).length}`,
      `  -> ${SNAPSHOT_PATH}`,
      "",
    ].join("\n"),
  );
}

// `require.main === module` rather than a bare call: importing this file (a test, or a future
// loader wanting the paths) must not write to disk as a side effect.
if (require.main === module) {
  normalize();
}
