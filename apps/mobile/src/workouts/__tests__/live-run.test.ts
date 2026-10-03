// ADR-049 / ADR-050. The live run engine: a pure, immutable state machine over GPS readings. It owns
// what the screen and the recovery store share: when moving time runs and stops, which readings
// count, and how a finished run becomes the upload the queue sends. The maths itself lives in
// @forjd/domain (run-calculations); what is proven here is the bookkeeping around it.
import { workoutSessionUploadRequestSchema } from '@forjd/contracts';
import { estimateRunActiveCaloriesKcal, estimateRunCaloriesKcal } from '@forjd/domain';

import {
  RUN_EXERCISE_PLACEHOLDER_ID,
  addFix,
  addHeartRate,
  finishRun,
  isRunWorthSaving,
  movingMsAt,
  pauseRun,
  resumeRun,
  runStats,
  runTrackStats,
  startRun,
  toRunUploadRequest,
  type RunState,
} from '../live-run';

const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180;
const T0 = 1_700_000_000_000;
const ID = '11111111-1111-4111-8111-111111111111';

const at = (meters: number, seconds: number, over: Record<string, unknown> = {}) => ({
  latitude: meters / METERS_PER_DEGREE,
  longitude: 0,
  altitudeMeters: null,
  accuracyMeters: 5,
  timestampMs: T0 + seconds * 1000,
  ...over,
});

/** A steady run at `speed` m/s, one fix a second, for `seconds`. */
function runSteadily(speed: number, seconds: number, from: RunState = startRun(ID, T0)): RunState {
  let state = from;
  for (let t = 1; t <= seconds; t += 1) state = addFix(state, at(speed * t, t));
  return state;
}

describe('startRun', () => {
  it('starts running, with no time moved and no readings', () => {
    const state = startRun(ID, T0);
    expect(state).toMatchObject({ id: ID, status: 'running', startedAtMs: T0, endedAtMs: null, fixes: [] });
    expect(movingMsAt(state, T0)).toBe(0);
  });
});

describe('moving time', () => {
  it('runs while running', () => {
    expect(movingMsAt(startRun(ID, T0), T0 + 90_000)).toBe(90_000);
  });

  it('stops while paused and picks up again on resume', () => {
    let state = startRun(ID, T0);
    state = pauseRun(state, T0 + 60_000);
    expect(movingMsAt(state, T0 + 600_000)).toBe(60_000);
    state = resumeRun(state, T0 + 660_000);
    expect(movingMsAt(state, T0 + 690_000)).toBe(90_000);
  });

  it('stops for good when the run is finished', () => {
    const state = finishRun(startRun(ID, T0), T0 + 120_000);
    expect(state.status).toBe('finished');
    expect(state.endedAtMs).toBe(T0 + 120_000);
    expect(movingMsAt(state, T0 + 999_000)).toBe(120_000);
  });

  it('ignores a second pause, a resume that was not paused, and a finish that was already done', () => {
    let state = pauseRun(startRun(ID, T0), T0 + 10_000);
    expect(pauseRun(state, T0 + 50_000)).toBe(state);
    const running = startRun(ID, T0);
    expect(resumeRun(running, T0 + 5_000)).toBe(running);
    state = finishRun(state, T0 + 20_000);
    expect(finishRun(state, T0 + 90_000)).toBe(state);
  });

  it('finishes a paused run without counting the paused stretch', () => {
    const state = finishRun(pauseRun(startRun(ID, T0), T0 + 30_000), T0 + 500_000);
    expect(movingMsAt(state, T0 + 500_000)).toBe(30_000);
  });
});

describe('addFix', () => {
  it('records a reading with the moving time it was taken at', () => {
    const state = addFix(startRun(ID, T0), at(0, 5));
    expect(state.fixes).toHaveLength(1);
    expect(state.fixes[0]).toMatchObject({ movingMs: 5000, timestampMs: T0 + 5000 });
  });

  it('marks the first reading as the start of a segment', () => {
    const state = addFix(startRun(ID, T0), at(0, 1));
    expect(state.fixes[0]?.segmentStart).toBe(true);
    expect(addFix(state, at(4, 2)).fixes[1]?.segmentStart).toBe(false);
  });

  it('ignores readings while paused or finished', () => {
    const paused = pauseRun(startRun(ID, T0), T0 + 1000);
    expect(addFix(paused, at(5, 2))).toBe(paused);
    const finished = finishRun(startRun(ID, T0), T0 + 1000);
    expect(addFix(finished, at(5, 2))).toBe(finished);
  });

  it('starts a new segment with the first reading after a resume, so the pause gap is not counted', () => {
    let state = runSteadily(3, 10);
    state = pauseRun(state, T0 + 10_000);
    state = resumeRun(state, T0 + 400_000);
    state = addFix(state, at(5000, 401));
    state = addFix(state, at(5003, 402));

    expect(state.fixes[state.fixes.length - 2]?.segmentStart).toBe(true);
    expect(state.fixes[state.fixes.length - 1]?.segmentStart).toBe(false);
    // 27 m between the first and last reading before the pause and 3 m after; the 5 km jump across it
    // is not counted.
    expect(runStats(state, T0 + 402_000).distanceMeters).toBeCloseTo(30, 0);
  });

  it('does not change the state it was given', () => {
    const before = startRun(ID, T0);
    const frozen = JSON.stringify(before);
    addFix(before, at(0, 1));
    expect(JSON.stringify(before)).toBe(frozen);
  });
});

describe('runStats', () => {
  it('is empty before any reading', () => {
    expect(runStats(startRun(ID, T0), T0 + 5000)).toMatchObject({
      distanceMeters: 0,
      movingSeconds: 5,
      averagePaceSecondsPerKm: null,
      currentSpeedMetersPerSecond: null,
      splits: [],
      elevationGainMeters: null,
      route: [],
    });
  });

  it('measures distance, pace, speed and splits of a steady 4 m/s run', () => {
    const state = runSteadily(4, 260);
    const stats = runStats(state, T0 + 260_000);

    expect(stats.distanceMeters).toBeCloseTo(1036, 0);
    expect(stats.movingSeconds).toBe(260);
    expect(stats.averagePaceSecondsPerKm).toBeCloseTo(251, 0);
    expect(stats.currentSpeedMetersPerSecond).toBeCloseTo(4, 1);
    expect(stats.splits).toHaveLength(1);
    expect(stats.splits[0]?.durationSeconds).toBeCloseTo(250, 1);
  });

  it('drops a GPS jump and keeps counting from the real position', () => {
    let state = runSteadily(3, 5);
    state = addFix(state, at(90_000, 6)); // a wild reading
    state = addFix(state, at(18, 6.5)); // then the truth again
    expect(runStats(state, T0 + 7000).distanceMeters).toBeLessThan(25);
  });

  it('gives the route as the accepted points, oldest first', () => {
    const stats = runStats(runSteadily(3, 4), T0 + 4000);
    expect(stats.route).toHaveLength(4);
    expect(stats.route[0]).toEqual({ latitude: expect.any(Number), longitude: 0 });
  });

  it('reports elevation only when the phone gave altitudes', () => {
    let state = startRun(ID, T0);
    for (const [i, altitude] of [100, 101, 104, 108].entries()) {
      state = addFix(state, at(i * 4, i + 1, { altitudeMeters: altitude }));
    }
    const stats = runStats(state, T0 + 4000);
    expect(stats.elevationGainMeters).toBeCloseTo(8, 5);
    expect(stats.netClimbMeters).toBeCloseTo(8, 5);
  });

  it('stops counting time when the run is paused for the whole of it', () => {
    const paused = pauseRun(runSteadily(3, 20), T0 + 20_000);
    expect(runStats(paused, T0 + 900_000).movingSeconds).toBe(20);
  });

  /**
   * The live screen ticks once a second; only the moving time and pace depend on the clock. The
   * GPS-only part (distance, splits, climb, the route) is passed in so the screen can keep it until
   * a new reading arrives, instead of re-walking every fix each second (live-run-plan follow-up, G6).
   */
  it('gives the same answer whether the GPS-only part is passed in or worked out', () => {
    const state = runSteadily(3, 120);

    expect(runStats(state, T0 + 130_000, runTrackStats(state.fixes))).toEqual(runStats(state, T0 + 130_000));
  });

  it('reuses the GPS-only part it is given, so the route is the same array from tick to tick', () => {
    const state = runSteadily(3, 120);
    const track = runTrackStats(state.fixes);

    const first = runStats(state, T0 + 120_000, track);
    const second = runStats(state, T0 + 121_000, track);

    expect(second.route).toBe(first.route);
    expect(second.movingSeconds).toBe(first.movingSeconds + 1);
  });
});

describe('isRunWorthSaving', () => {
  it('needs at least 50 m of real distance', () => {
    expect(isRunWorthSaving(runStats(runSteadily(3, 10), T0 + 10_000))).toBe(false);
    expect(isRunWorthSaving(runStats(runSteadily(3, 20), T0 + 20_000))).toBe(true);
  });
});

describe('addHeartRate', () => {
  it('keeps samples in order and drops implausible ones', () => {
    let state = startRun(ID, T0);
    state = addHeartRate(state, [
      { timestampMs: T0 + 2000, bpm: 140 },
      { timestampMs: T0 + 1000, bpm: 138 },
      { timestampMs: T0 + 3000, bpm: 20 },
      { timestampMs: T0 + 4000, bpm: 400 },
      { timestampMs: T0 + 5000, bpm: NaN },
    ]);
    expect(state.heartRate.map((s) => s.bpm)).toEqual([138, 140]);
  });

  it('does not add the same sample twice', () => {
    const samples = [{ timestampMs: T0 + 1000, bpm: 140 }];
    const once = addHeartRate(startRun(ID, T0), samples);
    expect(addHeartRate(once, samples).heartRate).toHaveLength(1);
  });
});

describe('toRunUploadRequest', () => {
  const finished = (): RunState => finishRun(runSteadily(4, 260), T0 + 260_000);
  const base = { weightKg: 70, allowStartLocation: false, healthDataAllowed: false, watchCaloriesKcal: null };

  it('refuses a run that has not been finished', () => {
    expect(() => toRunUploadRequest(runSteadily(4, 10), base)).toThrow();
    expect(() => toRunUploadRequest(pauseRun(runSteadily(4, 10), T0 + 10_000), base)).toThrow();
  });

  it('builds an upload the API contract accepts', () => {
    const body = toRunUploadRequest(finished(), base);
    expect(() => workoutSessionUploadRequestSchema.parse(body)).not.toThrow();
  });

  it('is a live-tracked running session named Outdoor Run, over the moving time', () => {
    const body = toRunUploadRequest(finished(), base);
    expect(body).toMatchObject({
      id: ID,
      name: 'Outdoor Run',
      activity: 'running',
      status: 'completed',
      isLiveTracked: true,
      durationSeconds: 260,
      startedAt: new Date(T0).toISOString(),
      endedAt: new Date(T0 + 260_000).toISOString(),
    });
  });

  it('logs one completed distance set against the Outdoor Run placeholder, resolved when it uploads', () => {
    const body = toRunUploadRequest(finished(), base);
    expect(body.exercises).toHaveLength(1);
    expect(body.exercises[0]?.exerciseId).toBe(RUN_EXERCISE_PLACEHOLDER_ID);
    expect(body.exercises[0]?.sets).toEqual([
      expect.objectContaining({ type: 'working', isCompleted: true, durationSeconds: 260 }),
    ]);
    expect(body.exercises[0]?.sets[0]?.distanceMeters).toBeCloseTo(1036, 0);
  });

  it('carries the summary: distance, moving time, splits and elevation', () => {
    const body = toRunUploadRequest(finished(), base);
    expect(body.run).toMatchObject({ movingSeconds: 260, elevationGainMeters: null });
    expect(body.run?.distanceMeters).toBeCloseTo(1036, 0);
    expect(body.run?.splits).toEqual([
      { index: 1, distanceMeters: 1000, durationSeconds: 250, avgHeartRateBpm: null },
    ]);
  });

  it('estimates calories from pace, climb and weight, and says so', () => {
    const body = toRunUploadRequest(finished(), base);
    expect(body.run?.caloriesSource).toBe('estimate');
    expect(body.run?.caloriesKcal).toBeGreaterThan(0);
  });

  it('sends no calories without a weight to estimate from', () => {
    const body = toRunUploadRequest(finished(), { ...base, weightKg: null });
    expect(body.run?.caloriesKcal).toBeNull();
    expect(body.run?.caloriesSource).toBeNull();
  });

  it("prefers the watch's calories when health data is allowed and it reported some", () => {
    const body = toRunUploadRequest(finished(), { ...base, healthDataAllowed: true, watchCaloriesKcal: 301 });
    expect(body.run).toMatchObject({ caloriesKcal: 301, caloriesSource: 'watch' });
  });

  it("ignores the watch's calories without health data consent, and estimates instead", () => {
    const body = toRunUploadRequest(finished(), { ...base, watchCaloriesKcal: 301 });
    expect(body.run?.caloriesSource).toBe('estimate');
    expect(body.run?.caloriesKcal).not.toBe(301);
  });

  it('adds average heart rate, overall and per split, only when health data is allowed', () => {
    const state = addHeartRate(finished(), [
      { timestampMs: T0 + 100_000, bpm: 140 },
      { timestampMs: T0 + 200_000, bpm: 160 },
    ]);

    const allowed = toRunUploadRequest(state, { ...base, healthDataAllowed: true });
    expect(allowed.run?.avgHeartRateBpm).toBe(150);
    expect(allowed.run?.splits[0]?.avgHeartRateBpm).toBe(150);

    const notAllowed = toRunUploadRequest(state, base);
    expect(notAllowed.run?.avgHeartRateBpm).toBeNull();
    expect(notAllowed.run?.splits[0]?.avgHeartRateBpm).toBeNull();
  });

  // scan-height-age-plan.md §4.4: the estimate is active energy, like the watch's figure, and uses
  // Keytel's heart-rate equation when heart rate (with consent), age and sex are known.
  it("reports active energy: the pace estimate minus resting energy from the scan's BMR", () => {
    const done = finished();
    const stats = runStats(done, done.endedAtMs!);
    const body = toRunUploadRequest(done, { ...base, bmrKcal: 1680 });
    const pace = { distanceMeters: stats.distanceMeters, movingSeconds: stats.movingSeconds, netClimbMeters: stats.netClimbMeters, weightKg: 70 };

    expect(body.run?.caloriesKcal).toBe(
      estimateRunActiveCaloriesKcal({ ...pace, bmrKcal: 1680, avgHeartRateBpm: null, ageYears: null, sex: null }),
    );
    expect(body.run!.caloriesKcal!).toBeLessThan(estimateRunCaloriesKcal(pace)!);
  });

  it('uses heart rate for the estimate only with health-data consent', () => {
    const state = addHeartRate(finished(), [
      { timestampMs: T0 + 100_000, bpm: 150 },
      { timestampMs: T0 + 200_000, bpm: 150 },
    ]);
    const stats = runStats(state, state.endedAtMs!);
    const person = { ...base, bmrKcal: 1680, ageYears: 30, sex: 'male' as const };
    const estimate = (avgHeartRateBpm: number | null) =>
      estimateRunActiveCaloriesKcal({
        distanceMeters: stats.distanceMeters,
        movingSeconds: stats.movingSeconds,
        netClimbMeters: stats.netClimbMeters,
        weightKg: 70,
        bmrKcal: 1680,
        avgHeartRateBpm,
        ageYears: 30,
        sex: 'male',
      });

    expect(toRunUploadRequest(state, { ...person, healthDataAllowed: true }).run?.caloriesKcal).toBe(estimate(150));
    expect(toRunUploadRequest(state, person).run?.caloriesKcal).toBe(estimate(null));
    expect(estimate(150)).not.toBe(estimate(null));
  });

  it('sends the first reading rounded to about 110 m as the start position, only when allowed', () => {
    const state = addFix(startRun(ID, T0), at(0, 1, { latitude: 31.2001234, longitude: 29.9187654 }));
    const done = finishRun(addFix(state, at(8, 3, { latitude: 31.2002, longitude: 29.9188 })), T0 + 3000);

    expect(toRunUploadRequest(done, base).startLocation).toBeNull();
    expect(toRunUploadRequest(done, { ...base, allowStartLocation: true }).startLocation).toEqual({
      latitude: 31.2,
      longitude: 29.919,
    });
  });

  it('sends no start position for a run that never got a reading', () => {
    const empty = finishRun(startRun(ID, T0), T0 + 5000);
    expect(toRunUploadRequest(empty, { ...base, allowStartLocation: true }).startLocation).toBeNull();
  });

  it('never carries the route, and no coordinate other than the rounded start', () => {
    const body = JSON.stringify(toRunUploadRequest(finished(), { ...base, allowStartLocation: true }));
    expect(body).not.toContain('route');
    expect(body).not.toContain('altitude');
    expect(body).not.toContain('accuracy');
  });

  it('clamps an estimate past the contract ceiling rather than sending a rejectable value', () => {
    // A day-long, very heavy-weight run pushes the ACSM estimate well past 20,000 kcal.
    const long = finishRun(runSteadily(3, 24 * 3600), T0 + 24 * 3600 * 1000);
    const body = toRunUploadRequest(long, { ...base, weightKg: 400 });
    expect(body.run?.caloriesKcal).toBeLessThanOrEqual(20_000);
  });

  it('clamps elevation gain past the contract ceiling', () => {
    let state = startRun(ID, T0);
    let altitude = 0;
    for (let t = 1; t <= 20; t += 1) {
      altitude += 2000; // a climb far larger than 10,000 m in total
      state = addFix(state, at(t, t, { altitudeMeters: altitude }));
    }
    const body = toRunUploadRequest(finishRun(state, T0 + 20_000), base);
    expect(body.run?.elevationGainMeters).toBeLessThanOrEqual(10_000);
  });

  it('keeps every value inside the contract limits for an extreme run', () => {
    // 250 km in 30 hours, 250 splits: clamped rather than refused, so the run still saves.
    const long: RunState = {
      ...finishRun(startRun(ID, T0), T0 + 30 * 3600 * 1000),
      fixes: Array.from({ length: 251 }, (_, i) => ({
        latitude: (i * 1000) / METERS_PER_DEGREE,
        longitude: 0,
        altitudeMeters: null,
        accuracyMeters: 5,
        timestampMs: T0 + i * 400_000,
        movingMs: i * 400_000,
        segmentStart: i === 0,
      })),
    };

    const body = toRunUploadRequest(long, base);

    expect(() => workoutSessionUploadRequestSchema.parse(body)).not.toThrow();
    expect(body.run?.splits.length).toBeLessThanOrEqual(200);
    expect(body.run?.movingSeconds).toBeLessThanOrEqual(86_400);
  });
});
