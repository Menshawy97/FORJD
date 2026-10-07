import { detectRunRecords, MIN_PACE_RECORD_METERS, paceSecondsPerKm } from "./run-records";

// Phase 12F slice 5b (docs/product/phase-12f-plan.md, rules confirmed by the owner 2026-10-07). A run is a record when it is the
// longest the person has run, or the fastest average pace among runs of at least 2 km, against their best before it. The first
// run (or the first of 2 km or more) has nothing to beat, so it is not a record.
const run = (distanceMeters: number, movingSeconds: number) => ({ distanceMeters, movingSeconds });
const none = { bestDistanceMeters: null, bestPaceSecPerKm: null };

describe("paceSecondsPerKm", () => {
  it("is seconds per kilometre", () => {
    expect(paceSecondsPerKm(run(5000, 1500))).toBe(300);
  });
  it("is null for a run with no distance or no time", () => {
    expect(paceSecondsPerKm(run(0, 100))).toBeNull();
    expect(paceSecondsPerKm(run(1000, 0))).toBeNull();
  });
});

describe("detectRunRecords", () => {
  it("is a longest-run record when it beats the longest before", () => {
    expect(detectRunRecords(run(10100, 4000), { bestDistanceMeters: 10000, bestPaceSecPerKm: 100 })).toEqual([
      { type: "run", record: "longest_run" },
    ]);
  });

  it("is a fastest-pace record when it is 2 km or more and faster than the best before", () => {
    expect(detectRunRecords(run(5000, 1400), { bestDistanceMeters: 8000, bestPaceSecPerKm: 300 })).toEqual([
      { type: "run", record: "fastest_pace" },
    ]);
  });

  it("can be both", () => {
    expect(detectRunRecords(run(12000, 3000), { bestDistanceMeters: 10000, bestPaceSecPerKm: 300 })).toEqual([
      { type: "run", record: "longest_run" },
      { type: "run", record: "fastest_pace" },
    ]);
  });

  it("is nothing for a first run, an equal run, or a slower and shorter one", () => {
    expect(detectRunRecords(run(5000, 1500), none)).toEqual([]);
    expect(detectRunRecords(run(10000, 3000), { bestDistanceMeters: 10000, bestPaceSecPerKm: 300 })).toEqual([]);
    expect(detectRunRecords(run(4000, 1400), { bestDistanceMeters: 10000, bestPaceSecPerKm: 300 })).toEqual([]);
  });

  it("does not count a pace over less than 2 km, and counts exactly 2 km", () => {
    const prior = { bestDistanceMeters: 20000, bestPaceSecPerKm: 300 };
    expect(detectRunRecords(run(MIN_PACE_RECORD_METERS - 1, 400), prior)).toEqual([]);
    expect(detectRunRecords(run(MIN_PACE_RECORD_METERS, 500), prior)).toEqual([{ type: "run", record: "fastest_pace" }]);
  });

  it("is not a pace record for the same run repeated, even when the distance is not a round number", () => {
    const distanceMeters = 5230.45;
    const movingSeconds = 1800;
    const priorPace = Math.round(((movingSeconds * 1000) / distanceMeters) * 100) / 100;

    expect(detectRunRecords(run(distanceMeters, movingSeconds), { bestDistanceMeters: distanceMeters, bestPaceSecPerKm: priorPace })).toEqual([]);
    expect(detectRunRecords(run(distanceMeters, movingSeconds - 5), { bestDistanceMeters: distanceMeters, bestPaceSecPerKm: priorPace })).toEqual([
      { type: "run", record: "fastest_pace" },
    ]);
  });

  it("can be a pace record when there is no pace before but a longest run is not beaten, only if a pace existed", () => {
    expect(detectRunRecords(run(5000, 1000), { bestDistanceMeters: 8000, bestPaceSecPerKm: null })).toEqual([]);
  });
});
