import { readFileSync } from "fs";
import { join } from "path";

import { Exercise } from "@forjd/domain";

import { UpsertCatalogueExerciseInput } from "../exercises.repository";
import { CatalogueTarget, loadCatalogue, parseSnapshot, SNAPSHOT_PATH } from "./load";

/**
 * The loader is tested as a pure function over a fake target, not against Postgres. Its
 * idempotency is not its own -- it is `ExercisesRepository.upsertCatalogueExercise`'s, which
 * `exercises.repository.spec.ts` already proves against real Postgres and a real partial
 * unique index. Re-testing that here would only re-assert a mock.
 *
 * What *is* the loader's own job, and is tested here: reading the committed snapshot without
 * touching the raw dataset, refusing a snapshot that does not describe itself correctly, and
 * passing `(source, sourceId)` through unchanged -- because that pair is the upsert key, and
 * a loader that rewrote either would turn every re-run into 873 new rows.
 */
describe("exercise catalogue loader", () => {
  const record = (sourceId: string, name: string): UpsertCatalogueExerciseInput => ({
    source: "free-exercise-db",
    sourceId,
    name,
    slug: name.toLowerCase().replace(/ /g, "-"),
    category: "strength",
    goal: "hypertrophy",
    measure: "weight",
    primaryMuscles: ["chest"],
    secondaryMuscles: [],
    equipment: ["barbell"],
    force: "push",
    level: "beginner",
    mechanic: "compound",
    instructions: ["Do the thing."],
    imageKeys: [],
    description: null,
  });

  const snapshotOf = (exercises: UpsertCatalogueExerciseInput[]) => ({
    source: "free-exercise-db",
    datasetPin: "see apps/api/src/exercises/ingest/data/SOURCE.md",
    count: exercises.length,
    exercises,
  });

  /** Records every call, and returns something shaped like the repository's return value. */
  const fakeTarget = (): CatalogueTarget & { calls: UpsertCatalogueExerciseInput[] } => {
    const calls: UpsertCatalogueExerciseInput[] = [];
    return {
      calls,
      upsertCatalogueExercise: (input: UpsertCatalogueExerciseInput): Promise<Exercise> => {
        calls.push(input);
        return Promise.resolve({ id: "generated" } as unknown as Exercise);
      },
    };
  };

  describe("parseSnapshot", () => {
    it("returns the exercises from a well-formed snapshot", () => {
      const exercises = [record("a", "Alpha"), record("b", "Bravo")];

      expect(parseSnapshot(snapshotOf(exercises))).toEqual(exercises);
    });

    it("rejects a snapshot that is not an object", () => {
      expect(() => parseSnapshot([])).toThrow(/object/i);
    });

    it("rejects a snapshot whose exercises are not an array", () => {
      expect(() => parseSnapshot({ source: "x", count: 0, exercises: {} })).toThrow(/array/i);
    });

    /**
     * The snapshot writes its own count. A file truncated in transit -- a partial checkout, a
     * bad merge resolution -- still parses as valid JSON with fewer exercises in it, and
     * without this check the loader would cheerfully upsert the survivors and report success
     * while the catalogue silently lost rows.
     */
    it("rejects a snapshot whose count disagrees with the exercises it carries", () => {
      const snapshot = { ...snapshotOf([record("a", "Alpha")]), count: 873 };

      expect(() => parseSnapshot(snapshot)).toThrow(/873/);
    });

    it("rejects a record with no source id, which cannot take part in the upsert key", () => {
      const broken = { ...record("a", "Alpha"), sourceId: "" };

      expect(() => parseSnapshot(snapshotOf([broken]))).toThrow(/sourceId/);
    });

    it("rejects a record with no source, the other half of the upsert key", () => {
      const broken = { ...record("a", "Alpha"), source: "" };

      expect(() => parseSnapshot(snapshotOf([broken]))).toThrow(/source/);
    });
  });

  describe("loadCatalogue", () => {
    it("upserts every exercise in the snapshot", async () => {
      const target = fakeTarget();
      const exercises = [record("a", "Alpha"), record("b", "Bravo"), record("c", "Charlie")];

      const result = await loadCatalogue(target, exercises);

      expect(target.calls).toHaveLength(3);
      expect(result.loaded).toBe(3);
    });

    it("passes source and sourceId through unchanged, since together they are the upsert key", async () => {
      const target = fakeTarget();

      await loadCatalogue(target, [record("Barbell_Bench_Press", "Barbell Bench Press")]);

      expect(target.calls[0]).toMatchObject({
        source: "free-exercise-db",
        sourceId: "Barbell_Bench_Press",
      });
    });

    it("passes the whole record through without reshaping it", async () => {
      const target = fakeTarget();
      const one = record("a", "Alpha");

      await loadCatalogue(target, [one]);

      expect(target.calls[0]).toEqual(one);
    });

    /**
     * A deploy step that swallows failures is worse than no deploy step: the catalogue would
     * be half-loaded and the workflow green, and nobody would look again until a user
     * reported a missing exercise.
     */
    it("fails loudly when the repository rejects, rather than continuing", async () => {
      const target: CatalogueTarget = {
        upsertCatalogueExercise: () => Promise.reject(new Error("connection terminated")),
      };

      await expect(loadCatalogue(target, [record("a", "Alpha")])).rejects.toThrow(
        /connection terminated/,
      );
    });

    it("does nothing and reports zero for an empty catalogue", async () => {
      const target = fakeTarget();

      expect((await loadCatalogue(target, [])).loaded).toBe(0);
      expect(target.calls).toHaveLength(0);
    });
  });

  /**
   * Reads the *committed snapshot*, never the raw dataset -- the whole point of Phase D's
   * pipeline, and enforced by `scripts/ci/check-architecture-conformance.sh`. This is the
   * test that would fail if the snapshot were regenerated into a shape the loader cannot
   * consume, which is the one way the two halves of the ingest pipeline can drift.
   */
  describe("the committed snapshot", () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as unknown;

    it("parses, and every record carries the free-exercise-db source", () => {
      const exercises = parseSnapshot(snapshot);

      expect(exercises.length).toBeGreaterThan(0);
      expect(exercises.every((exercise) => exercise.source === "free-exercise-db")).toBe(true);
    });

    it("has a unique source id per record, so no two rows collide on the upsert key", () => {
      const exercises = parseSnapshot(snapshot);
      const ids = new Set(exercises.map((exercise) => exercise.sourceId));

      expect(ids.size).toBe(exercises.length);
    });

    it("lives beside the ingest code it was written by", () => {
      expect(SNAPSHOT_PATH).toBe(join(__dirname, "data", "normalized-exercises.json"));
    });
  });
});
