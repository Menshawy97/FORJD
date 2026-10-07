import type { PrRecord } from "./push-messages";

/**
 * Which records a run set (Phase 12F slice 5b, docs/product/phase-12f-plan.md; rules confirmed by the owner 2026-10-07). Pure:
 * the caller reads the person's bests before the run, this decides. A run is a record when it is the **longest** they have run,
 * or the **fastest average pace among runs of at least 2 km**, against their best before it. A first run (or the first of 2 km or
 * more) has nothing to beat, so it is not a record. Distance, time and pace are training facts, but the push shows no figure
 * (ADR-061); heart rate and calories are never read.
 */
export const MIN_PACE_RECORD_METERS = 2000;

export interface RunFigures {
  distanceMeters: number;
  movingSeconds: number;
}

export interface PriorRunBests {
  /** The longest run before this one, or `null` when there was none. */
  bestDistanceMeters: number | null;
  /** The fastest (lowest) pace in seconds per km among earlier runs of 2 km or more, or `null` when there was none. */
  bestPaceSecPerKm: number | null;
}

export function paceSecondsPerKm(run: RunFigures): number | null {
  if (run.distanceMeters <= 0 || run.movingSeconds <= 0) return null;
  return (run.movingSeconds * 1000) / run.distanceMeters;
}

/** Paces are compared to a hundredth of a second per km, so float noise can never make a repeat of the same run a record. */
const roundPace = (pace: number): number => Math.round(pace * 100) / 100;

export function detectRunRecords(run: RunFigures, prior: PriorRunBests): PrRecord[] {
  const records: PrRecord[] = [];
  if (prior.bestDistanceMeters !== null && run.distanceMeters > prior.bestDistanceMeters) {
    records.push({ type: "run", record: "longest_run" });
  }
  const pace = paceSecondsPerKm(run);
  if (
    pace !== null &&
    run.distanceMeters >= MIN_PACE_RECORD_METERS &&
    prior.bestPaceSecPerKm !== null &&
    roundPace(pace) < roundPace(prior.bestPaceSecPerKm)
  ) {
    records.push({ type: "run", record: "fastest_pace" });
  }
  return records;
}
