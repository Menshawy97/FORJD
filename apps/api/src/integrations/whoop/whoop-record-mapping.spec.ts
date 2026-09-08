import recoveryFixture from "./__fixtures__/recovery.json";
import sleepFixture from "./__fixtures__/sleep.json";
import workoutFixture from "./__fixtures__/workout.json";
import { mapRecoveryToObservations, mapSleepToObservations, mapWorkoutToObservations } from "./whoop-record-mapping";

/**
 * Pure WHOOP-record -> SyncedObservation[] mapping, tested against fixtures shaped exactly
 * like WHOOP's real v2 API responses (field names and units confirmed against WHOOP's own
 * developer docs during Phase 7 planning) -- this is the file ADR-004 warns is where an
 * integration's normalization actually corrupts data silently if untested. No network, no
 * mocking: these are pure functions over plain objects.
 */
describe("whoop-record-mapping", () => {
  describe("mapRecoveryToObservations", () => {
    it("maps hrv and resting_heart_rate to the two canonical metrics WHOOP leads on", () => {
      const observations = mapRecoveryToObservations(recoveryFixture);

      const hrv = observations.find((o) => o.metricType === "hrv");
      expect(hrv).toEqual({
        metricType: "hrv",
        value: 62.3,
        unit: "ms",
        startTime: new Date("2026-09-08T07:15:22.123Z"),
        endTime: new Date("2026-09-08T07:15:22.123Z"),
        providerRecordId: "93845",
        deviceId: null,
        quality: null,
      });

      const rhr = observations.find((o) => o.metricType === "resting_heart_rate");
      expect(rhr).toMatchObject({ metricType: "resting_heart_rate", value: 48, unit: "bpm" });
    });

    it("returns exactly two observations for a fully-scored recovery", () => {
      expect(mapRecoveryToObservations(recoveryFixture)).toHaveLength(2);
    });

    it("uses cycle_id as the provider record id, stable across re-delivery for dedup", () => {
      const observations = mapRecoveryToObservations(recoveryFixture);
      for (const observation of observations) {
        expect(observation.providerRecordId).toBe("93845");
      }
    });

    it("returns no observations for a recovery that has not scored yet", () => {
      const pending = { ...recoveryFixture, score_state: "PENDING_SCORE", score: undefined };
      expect(mapRecoveryToObservations(pending)).toEqual([]);
    });

    it("returns no observations for an unscorable recovery", () => {
      const unscorable = { ...recoveryFixture, score_state: "UNSCORABLE", score: undefined };
      expect(mapRecoveryToObservations(unscorable)).toEqual([]);
    });
  });

  describe("mapSleepToObservations", () => {
    it("maps every sleep-stage duration from milliseconds to minutes", () => {
      const observations = mapSleepToObservations(sleepFixture);

      expect(observations.find((o) => o.metricType === "sleep_light_duration")).toMatchObject({
        value: 240, // 14_400_000ms / 60_000
        unit: "min",
      });
      expect(observations.find((o) => o.metricType === "sleep_deep_duration")).toMatchObject({
        value: 105, // 6_300_000ms / 60_000
        unit: "min",
      });
      expect(observations.find((o) => o.metricType === "sleep_rem_duration")).toMatchObject({
        value: 130, // 7_800_000ms / 60_000
        unit: "min",
      });
      expect(observations.find((o) => o.metricType === "sleep_awake_duration")).toMatchObject({
        value: 20, // 1_200_000ms / 60_000
        unit: "min",
      });
    });

    it("derives sleep_duration as light + deep + rem, excluding awake and no-data time", () => {
      const observations = mapSleepToObservations(sleepFixture);
      // (14_400_000 + 6_300_000 + 7_800_000) / 60_000 = 475
      expect(observations.find((o) => o.metricType === "sleep_duration")).toMatchObject({ value: 475, unit: "min" });
    });

    it("maps respiratory_rate straight through with no conversion", () => {
      const observations = mapSleepToObservations(sleepFixture);
      expect(observations.find((o) => o.metricType === "respiratory_rate")).toMatchObject({
        value: 15.2,
        unit: "breaths/min",
      });
    });

    it("uses the sleep's own start/end as every observation's window and its id as the provider record id", () => {
      const observations = mapSleepToObservations(sleepFixture);
      for (const observation of observations) {
        expect(observation.startTime).toEqual(new Date("2026-09-07T22:30:00.000Z"));
        expect(observation.endTime).toEqual(new Date("2026-09-08T06:45:00.000Z"));
        expect(observation.providerRecordId).toBe("3e3f7c8a-1b2d-4e5f-9a0b-1c2d3e4f5a6b");
        expect(observation.deviceId).toBeNull();
        expect(observation.quality).toBeNull();
      }
    });

    it("returns exactly six observations for a fully-scored sleep (4 stages + total + respiratory rate)", () => {
      expect(mapSleepToObservations(sleepFixture)).toHaveLength(6);
    });

    it("returns no observations for a sleep that has not scored yet", () => {
      const pending = { ...sleepFixture, score_state: "PENDING_SCORE", score: undefined };
      expect(mapSleepToObservations(pending)).toEqual([]);
    });
  });

  describe("mapWorkoutToObservations", () => {
    it("converts kilojoule to kcal (dividing by 4.184) as active_energy", () => {
      const observations = mapWorkoutToObservations(workoutFixture);
      // 2100.5 / 4.184 = 502.03...
      expect(observations).toHaveLength(1);
      expect(observations[0]).toEqual({
        metricType: "active_energy",
        value: 2100.5 / 4.184,
        unit: "kcal",
        startTime: new Date("2026-09-08T08:00:00.000Z"),
        endTime: new Date("2026-09-08T09:00:00.000Z"),
        providerRecordId: "8f4e2d1c-6b5a-4d3e-8c1b-2a3d4e5f6a7b",
        deviceId: null,
        quality: null,
      });
    });

    it("returns no observations for a workout that has not scored yet", () => {
      const pending = { ...workoutFixture, score_state: "PENDING_SCORE", score: undefined };
      expect(mapWorkoutToObservations(pending)).toEqual([]);
    });
  });
});
