import { type MuscleGroup } from "./exercise-vocabulary";

/**
 * Progress calculations — the derived numbers behind the Progress tab's Strength view.
 *
 * Domain code: no UI, no provider SDK, no database (CLAUDE.md rules 1 and 2). It sits beside
 * `training-calculations.ts` for the same reason that file gives: the API computes these for
 * the response and the app may yet compute them locally, and two implementations of one
 * formula are two chances to disagree about an athlete's own numbers.
 *
 * **Volume load is `sets x reps x load`** — Hornsby et al. (2018), *Resistance training volume
 * load with and without exercise displacement*, Sports 6(4):137, doi:10.3390/sports6040137,
 * which calls it "the most common resistance training volume calculation". Summing
 * `weightKg x reps` over completed sets, as this app already does, is that formula.
 * See ADR-030 for the full evidence base behind everything the Progress screen asserts.
 */

/**
 * The six rows the design's "Muscle group split" card draws
 * (`FORJD Mobile.dc.html` `muscleVals()`, and `progress strength 2.png`).
 *
 * Deliberately **not** `MUSCLE_GROUPS`. That vocabulary answers "what does this exercise
 * train", at the nineteen-value granularity free-exercise-db's data needs; this one answers
 * "which of the six bars does this volume belong to". Collapsing happens here, once, rather
 * than in whichever screen or query happened to need it.
 */
export const MUSCLE_SPLIT_BUCKETS = [
  "legs",
  "back",
  "chest",
  "shoulders",
  "arms",
  "core",
] as const;
export type MuscleSplitBucket = (typeof MUSCLE_SPLIT_BUCKETS)[number];

export const MUSCLE_SPLIT_BUCKET_DISPLAY_NAMES: Record<MuscleSplitBucket, string> = {
  legs: "Legs",
  back: "Back",
  chest: "Chest",
  shoulders: "Shoulders",
  arms: "Arms",
  core: "Core",
};

/**
 * Which bar a canonical muscle group's volume belongs to, or `null` when it belongs to none.
 *
 * The map is exhaustive over `MuscleGroup` by construction — a `Record`, not a lookup with a
 * fallback — so adding a twentieth muscle to the vocabulary fails the build here rather than
 * quietly vanishing from the chart.
 *
 * **`full_body` and `neck` are excluded on purpose.** `full_body` belongs to every bucket,
 * which means it distinguishes nothing and would only dilute whichever bars it was spread
 * across; `neck` has no row in the design. Both return `null` and their volume is left out of
 * the split entirely rather than being attributed somewhere it does not belong.
 */
const BUCKET_BY_MUSCLE: Record<MuscleGroup, MuscleSplitBucket | null> = {
  chest: "chest",
  shoulders: "shoulders",
  core: "core",
  // The vocabulary carries `back`, `lats`, `traps` and `lower_back` as separate values, so a
  // group-by on the raw column would draw four back rows where the design draws one.
  back: "back",
  lats: "back",
  traps: "back",
  lower_back: "back",
  biceps: "arms",
  triceps: "arms",
  forearms: "arms",
  quads: "legs",
  hamstrings: "legs",
  glutes: "legs",
  calves: "legs",
  hips: "legs",
  abductors: "legs",
  adductors: "legs",
  neck: null,
  full_body: null,
};

export function muscleSplitBucketFor(muscle: MuscleGroup): MuscleSplitBucket | null {
  return BUCKET_BY_MUSCLE[muscle];
}

/**
 * A set's volume, divided equally among the buckets that set trained.
 *
 * **Equal division, not full attribution to each.** An exercise listing two primary muscles
 * could credit its whole volume to both, but then the parts sum to more than the whole and the
 * resulting percentages cannot add to 100 — which is the shape the design shows
 * (28+22+18+14+12+6). Splitting keeps the chart internally honest.
 *
 * Buckets are deduplicated first: a lift whose primaries are `lats` and `traps` trains the back
 * once, and would otherwise be counted twice against a lift whose primary is just `back`.
 */
export function distributeSetVolume(
  volumeKg: number,
  buckets: readonly MuscleSplitBucket[],
): Partial<Record<MuscleSplitBucket, number>> {
  const distinct = [...new Set(buckets)];
  if (distinct.length === 0) return {};

  const share = volumeKg / distinct.length;
  const distributed: Partial<Record<MuscleSplitBucket, number>> = {};
  for (const bucket of distinct) {
    distributed[bucket] = (distributed[bucket] ?? 0) + share;
  }
  return distributed;
}

export interface MuscleSplitRow {
  bucket: MuscleSplitBucket;
  /** A whole number. Across the returned rows these sum to exactly 100. */
  percent: number;
}

/**
 * Accumulated per-bucket volume turned into the whole-number percentages the card renders,
 * ordered by descending share as the design lists them.
 *
 * **Largest remainder, because the labels are visible.** Rounding each share independently
 * loses points: three equal thirds become 33/33/33 and the card reads "99%", which looks like
 * a bug to the one person who adds the column up. The rows with the largest discarded
 * fractions absorb the difference, so the total is 100 by construction rather than by luck.
 *
 * Zero-volume buckets are omitted rather than drawn as empty rows -- a bar at 0% says nothing
 * the missing row does not already say, and the design shows six rows because six were trained.
 */
export function toPercentages(
  volumeByBucket: Partial<Record<MuscleSplitBucket, number>>,
): MuscleSplitRow[] {
  const entries = MUSCLE_SPLIT_BUCKETS.map((bucket) => ({
    bucket,
    volume: volumeByBucket[bucket] ?? 0,
  })).filter((entry) => entry.volume > 0);

  const total = entries.reduce((sum, entry) => sum + entry.volume, 0);
  if (total <= 0) return [];

  const scaled = entries.map((entry) => {
    const exact = (entry.volume / total) * 100;
    const floor = Math.floor(exact);
    return { bucket: entry.bucket, volume: entry.volume, floor, remainder: exact - floor };
  });

  let remaining = 100 - scaled.reduce((sum, entry) => sum + entry.floor, 0);
  // Hand the leftover points to the largest discarded fractions first. Ties break on the larger
  // raw volume so the result does not depend on `MUSCLE_SPLIT_BUCKETS`' declaration order.
  const byRemainder = [...scaled].sort(
    (left, right) => right.remainder - left.remainder || right.volume - left.volume,
  );
  const bonus = new Set<MuscleSplitBucket>();
  for (const entry of byRemainder) {
    if (remaining <= 0) break;
    bonus.add(entry.bucket);
    remaining -= 1;
  }

  return scaled
    .map((entry) => ({
      bucket: entry.bucket,
      percent: entry.floor + (bonus.has(entry.bucket) ? 1 : 0),
    }))
    .sort((left, right) => right.percent - left.percent);
}
