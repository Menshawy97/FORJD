import {
  ACSM_RUNNING_THRESHOLD_M_PER_MIN,
  acceptFix,
  averageHeartRate,
  averagePaceSecondsPerKm,
  buildTrack,
  currentSpeedMetersPerSecond,
  elevationGainMeters,
  estimateRunActiveCaloriesKcal,
  estimateRunCaloriesKcal,
  KEYTEL_MIN_HEART_RATE_BPM,
  haversineMeters,
  netClimbMeters,
  RunFix,
  splitsFromTrack,
  trackDistanceMeters,
} from './run-calculations';
import { METERS_PER_MILE } from './unit-conversion';

// One degree of latitude on the mean-radius sphere (R = 6,371,000 m): 111,194.93 m, computed exactly
// so a test that says "1,000 m" really is 1,000 m to the haversine.
const METERS_PER_DEGREE = (6_371_000 * Math.PI) / 180;

/** A fix `meters` north of the start, `seconds` into the run. */
function fix(meters: number, seconds: number, over: Partial<RunFix> = {}): RunFix {
  return {
    latitude: meters / METERS_PER_DEGREE,
    longitude: 0,
    altitudeMeters: null,
    accuracyMeters: 5,
    timestampMs: 1_000_000 + seconds * 1000,
    movingMs: seconds * 1000,
    segmentStart: false,
    ...over,
  };
}

/** A straight run at constant `speed` m/s, one fix every `step` seconds. */
function steadyRun(speed: number, totalSeconds: number, step = 5): RunFix[] {
  const fixes: RunFix[] = [];
  for (let t = 0; t <= totalSeconds; t += step) fixes.push(fix(speed * t, t));
  return fixes;
}

describe('haversineMeters', () => {
  it('measures one degree of latitude as about 111.2 km', () => {
    const a = fix(0, 0);
    const b = { ...fix(0, 1), latitude: 1 };
    expect(haversineMeters(a, b)).toBeCloseTo(METERS_PER_DEGREE, 0);
  });

  it('is zero between identical points', () => {
    expect(haversineMeters(fix(0, 0), fix(0, 5))).toBe(0);
  });

  it('is symmetric', () => {
    const a = { ...fix(0, 0), latitude: 30.05, longitude: 31.24 };
    const b = { ...fix(0, 1), latitude: 31.2, longitude: 29.92 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('shrinks a degree of longitude by the cosine of the latitude', () => {
    const a = { ...fix(0, 0), latitude: 60, longitude: 0 };
    const b = { ...fix(0, 1), latitude: 60, longitude: 1 };
    expect(haversineMeters(a, b)).toBeCloseTo(METERS_PER_DEGREE * 0.5, -1);
  });
});

describe('acceptFix', () => {
  it('accepts the first accurate fix', () => {
    expect(acceptFix(null, fix(0, 0))).toBe(true);
  });

  it('rejects a fix whose accuracy is worse than 25 m', () => {
    expect(acceptFix(null, fix(0, 0, { accuracyMeters: 25.1 }))).toBe(false);
    expect(acceptFix(null, fix(0, 0, { accuracyMeters: 25 }))).toBe(true);
  });

  it('lets a fix with unknown accuracy follow a known one, but never anchor the track', () => {
    // Unknown accuracy cannot be judged, but it can be checked by speed against its predecessor.
    expect(acceptFix(fix(0, 0), fix(10, 5, { accuracyMeters: null }))).toBe(true);
    // As the first fix, or the first after a pause, everything else is judged against it.
    expect(acceptFix(null, fix(0, 0, { accuracyMeters: null }))).toBe(false);
    expect(acceptFix(fix(0, 0), fix(10, 5, { accuracyMeters: null, segmentStart: true }))).toBe(false);
  });

  it('rejects any reading with a non-finite number in it', () => {
    expect(acceptFix(null, { ...fix(0, 0), latitude: NaN })).toBe(false);
    expect(acceptFix(null, { ...fix(0, 0), longitude: Infinity })).toBe(false);
    expect(acceptFix(null, { ...fix(0, 0), accuracyMeters: NaN })).toBe(false);
    expect(acceptFix(fix(0, 0), { ...fix(5, 5), movingMs: NaN })).toBe(false);
    expect(acceptFix(fix(0, 0), { ...fix(5, 5), timestampMs: NaN })).toBe(false);
  });

  it('rejects a reading whose wall-clock time does not advance, even if moving time does', () => {
    expect(acceptFix(fix(0, 5), { ...fix(5, 10), timestampMs: fix(0, 5).timestampMs })).toBe(false);
    expect(acceptFix(fix(0, 5), { ...fix(5, 10), timestampMs: fix(0, 5).timestampMs - 1 })).toBe(false);
  });

  it('rejects a post-pause reading that goes backwards in either clock', () => {
    const before = fix(0, 10);
    expect(acceptFix(before, fix(500, 9, { segmentStart: true }))).toBe(false);
    expect(acceptFix(before, fix(500, 12, { segmentStart: true, timestampMs: before.timestampMs }))).toBe(false);
    // Moving time may stand still across a pause: it is the wall clock that must advance.
    expect(acceptFix(before, fix(500, 10, { segmentStart: true, timestampMs: before.timestampMs + 60_000 }))).toBe(true);
  });

  it('rejects a jump faster than 12 m/s and accepts a fast sprint just under it', () => {
    // 100 m in 5 s is 20 m/s; 59.5 m in 5 s is 11.9 m/s; 60.5 m in 5 s is 12.1 m/s.
    expect(acceptFix(fix(0, 0), fix(100, 5))).toBe(false);
    expect(acceptFix(fix(0, 0), fix(59.5, 5))).toBe(true);
    expect(acceptFix(fix(0, 0), fix(60.5, 5))).toBe(false);
  });

  it('rejects a fix that is not later than the previous one', () => {
    expect(acceptFix(fix(0, 10), fix(5, 10))).toBe(false);
    expect(acceptFix(fix(0, 10), fix(5, 9))).toBe(false);
  });

  it('does not judge the first fix after a pause by speed, only by accuracy', () => {
    const afterPause = fix(500, 6, { segmentStart: true });
    expect(acceptFix(fix(0, 5), afterPause)).toBe(true);
    expect(acceptFix(fix(0, 5), { ...afterPause, accuracyMeters: 40 })).toBe(false);
  });
});

describe('buildTrack', () => {
  it('drops a jump and judges later fixes against the last accepted one', () => {
    // 400 m at 10 s is a 77 m/s jump from the 15 m fix at 5 s, so it is dropped. The 30 m fix at
    // 11 s is 2.5 m/s from that same 5 s fix, so it stays.
    const track = buildTrack([fix(0, 0), fix(15, 5), fix(400, 10), fix(30, 11)]);
    expect(track.map((f) => f.movingMs)).toEqual([0, 5000, 11000]);
  });

  it('returns an empty track for no fixes', () => {
    expect(buildTrack([])).toEqual([]);
  });

  it('does not judge a fix by speed when it starts a new segment', () => {
    const track = buildTrack([fix(0, 0), fix(15, 5), fix(9000, 6, { segmentStart: true }), fix(9015, 11)]);
    expect(track).toHaveLength(4);
    expect(trackDistanceMeters(track)).toBeCloseTo(30, 0);
  });

  it('recovers when the first fix was accurate but wrong', () => {
    // A cold-start fix 50 km off, then real readings: each looks like a jump from it. After five
    // in a row, the next starts a new segment, so the run records from there instead of never.
    const raw = [
      fix(50_000, 0),
      fix(0, 5),
      fix(3, 10),
      fix(6, 15),
      fix(9, 20),
      fix(12, 25),
      fix(15, 30),
      fix(18, 35),
    ];
    // The wrong first fix is dropped, not kept as a one-reading segment: no later reading agreed with it, and kept it
    // drew a line to it on the route map and was sent as the run's start position (production smoke test 2026-10-20,
    // an emulator whose first fix was in California and every later one in Cairo).
    const track = buildTrack(raw);
    expect(track.map((f) => f.movingMs)).toEqual([25000, 30000, 35000]);
    expect(track[0]?.latitude).toBeCloseTo(12 / METERS_PER_DEGREE, 9);
    expect(trackDistanceMeters(track)).toBeCloseTo(6, 0);
  });

  it('keeps a real segment it re-anchors away from', () => {
    // A segment two readings long was confirmed, so a later jump away from it starts a new segment but keeps it.
    const raw = [fix(0, 0), fix(10, 5), ...[1, 2, 3, 4, 5, 6].map((t) => fix(50_000 + t * 3, 5 + t * 5))];
    const track = buildTrack(raw);
    expect(track[0]?.movingMs).toBe(0);
    expect(track[1]?.movingMs).toBe(5000);
    expect(track[2]?.segmentStart).toBe(true);
  });

  it('does not re-anchor on readings that are individually unusable', () => {
    const bad = [1, 2, 3, 4, 5, 6].map((t) => fix(t * 3, t * 5, { accuracyMeters: 60 }));
    expect(buildTrack([fix(0, 0), ...bad])).toHaveLength(1);
  });
});

describe('trackDistanceMeters', () => {
  it('sums the steps of a steady run', () => {
    expect(trackDistanceMeters(steadyRun(4, 250))).toBeCloseTo(1000, 0);
  });

  it('is zero for fewer than two fixes', () => {
    expect(trackDistanceMeters([])).toBe(0);
    expect(trackDistanceMeters([fix(0, 0)])).toBe(0);
  });

  it('does not count the gap across a pause', () => {
    // 100 m run, paused, then resumed 5 km away: only the 100 m before and the 100 m after count.
    const track = [fix(0, 0), fix(100, 25), fix(5100, 26, { segmentStart: true }), fix(5200, 51)];
    expect(trackDistanceMeters(track)).toBeCloseTo(200, 0);
  });
});

describe('splitsFromTrack', () => {
  // Runs in miles (docs/product/run-miles-plan.md): the same splitter, one split per mile, for display only.
  it('finds each full mile when given the mile as the split length', () => {
    const splits = splitsFromTrack(steadyRun(4, 900), METERS_PER_MILE);
    expect(splits).toHaveLength(2);
    expect(splits[0]).toMatchObject({ index: 1, distanceMeters: METERS_PER_MILE });
    expect(splits[0]?.durationSeconds).toBeCloseTo(METERS_PER_MILE / 4, 3);
    expect(splits[1]?.durationSeconds).toBeCloseTo(METERS_PER_MILE / 4, 3);
  });

  it('finds each full kilometre at a steady 4 m/s', () => {
    const splits = splitsFromTrack(steadyRun(4, 625));
    expect(splits).toHaveLength(2);
    expect(splits[0]).toMatchObject({ index: 1, distanceMeters: 1000 });
    expect(splits[0]?.durationSeconds).toBeCloseTo(250, 3);
    expect(splits[1]?.index).toBe(2);
    expect(splits[1]?.durationSeconds).toBeCloseTo(250, 3);
  });

  it('interpolates the crossing between two fixes', () => {
    // 4 m/s with a fix every 30 s: 960 m at 240 s, 1,080 m at 270 s. The 1,000 m boundary is
    // 40/120 of the way along that step, at exactly 250 s.
    const splits = splitsFromTrack(steadyRun(4, 300, 30));
    expect(splits).toHaveLength(1);
    expect(splits[0]?.durationSeconds).toBeCloseTo(250, 3);
  });

  it('reports a slower second kilometre as a longer split', () => {
    const track: RunFix[] = [];
    for (let t = 0; t <= 250; t += 5) track.push(fix(4 * t, t));
    // Past 2,000 m, not exactly on it: summed float distances can land a hair short of a boundary.
    for (let t = 255; t <= 760; t += 5) track.push(fix(1000 + 2 * (t - 250), t));
    const splits = splitsFromTrack(track);
    expect(splits.map((s) => Math.round(s.durationSeconds))).toEqual([250, 500]);
  });

  it('reports the wall-clock span of each split', () => {
    const splits = splitsFromTrack(steadyRun(4, 300));
    const [first] = splits;
    expect(first?.startTimestampMs).toBe(1_000_000);
    expect((first?.endTimestampMs ?? 0) - (first?.startTimestampMs ?? 0)).toBeCloseTo(250_000, -1);
  });

  it('counts a kilometre reached exactly at the end of the run', () => {
    // 4 m/s for 250 s is exactly 1,000 m; summed float steps may land a hair short of it.
    const splits = splitsFromTrack(steadyRun(4, 250));
    expect(splits).toHaveLength(1);
    expect(splits[0]?.durationSeconds).toBeCloseTo(250, 3);
  });

  it('has no splits for a run shorter than a kilometre', () => {
    expect(splitsFromTrack(steadyRun(4, 200))).toEqual([]);
    expect(splitsFromTrack([])).toEqual([]);
  });

  it('crosses several boundaries in one long step', () => {
    // 2,500 m in 500 s between two fixes (5 m/s): boundaries at 200 s and 400 s.
    const splits = splitsFromTrack([fix(0, 0), fix(2500, 500)]);
    expect(splits).toHaveLength(2);
    expect(splits[0]?.durationSeconds).toBeCloseTo(200, 3);
    expect(splits[1]?.durationSeconds).toBeCloseTo(200, 3);
  });

  it('never carries a split across a pause gap', () => {
    // 600 m in 150 s, a pause (wall clock moves on, the moving clock does not) that jumps 5 km,
    // then 600 m more in 150 s: 1,200 m counted. The kilometre falls 400 m into the second stretch,
    // at 150 + 100 = 250 s of moving time.
    const track = [
      fix(0, 0),
      fix(600, 150),
      fix(5600, 150, { segmentStart: true, timestampMs: 1_400_000 }),
      fix(6200, 300, { timestampMs: 1_550_000 }),
    ];
    const splits = splitsFromTrack(track);
    expect(splits).toHaveLength(1);
    expect(splits[0]?.durationSeconds).toBeCloseTo(250, 0);
  });
});

describe('averagePaceSecondsPerKm', () => {
  it('divides moving time by distance', () => {
    // 3,430 m in 1,287 s is 375.2 s/km (6:15).
    expect(averagePaceSecondsPerKm(3430, 1287)).toBeCloseTo(375.2, 1);
  });

  it('has no pace before there is any distance or time', () => {
    expect(averagePaceSecondsPerKm(0, 100)).toBeNull();
    expect(averagePaceSecondsPerKm(500, 0)).toBeNull();
  });
});

describe('currentSpeedMetersPerSecond', () => {
  it('reads a steady 3 m/s over the last 10 seconds', () => {
    expect(currentSpeedMetersPerSecond(steadyRun(3, 60, 1))).toBeCloseTo(3, 1);
  });

  it('follows a change of pace within the window', () => {
    const track: RunFix[] = [];
    for (let t = 0; t <= 30; t += 1) track.push(fix(2 * t, t));
    for (let t = 31; t <= 60; t += 1) track.push(fix(60 + 4 * (t - 30), t));
    expect(currentSpeedMetersPerSecond(track)).toBeCloseTo(4, 1);
  });

  it('is unknown with fewer than two fixes in the window', () => {
    expect(currentSpeedMetersPerSecond([fix(0, 0)])).toBeNull();
    expect(currentSpeedMetersPerSecond([fix(0, 0), fix(50, 30)])).toBeNull();
    expect(currentSpeedMetersPerSecond([])).toBeNull();
  });

  it('does not measure across a pause', () => {
    const track = [fix(0, 0), fix(3, 1), fix(6, 2), fix(9000, 3, { segmentStart: true }), fix(9003, 4)];
    expect(currentSpeedMetersPerSecond(track)).toBeCloseTo(3, 1);
  });
});

describe('elevationGainMeters', () => {
  const at = (altitude: number | null, t: number) => fix(t, t, { altitudeMeters: altitude });

  it('ignores wobble smaller than 3 m and counts a climb once it passes 3 m', () => {
    const track = [100, 101, 102, 103.5].map((alt, i) => at(alt, i));
    expect(elevationGainMeters(track)).toBeCloseTo(3.5, 5);
  });

  it('counts only climbs, and resets its reference on a real descent', () => {
    // Up 3.5, down 3.5 (no gain, reference back at 100), up 3.2 more.
    const track = [100, 103.5, 100, 103.2].map((alt, i) => at(alt, i));
    expect(elevationGainMeters(track)).toBeCloseTo(6.7, 5);
  });

  it('counts a rise of exactly 3 m and ignores one just under it', () => {
    expect(elevationGainMeters([100, 103].map((alt, i) => at(alt, i)))).toBe(3);
    expect(elevationGainMeters([100, 102.99].map((alt, i) => at(alt, i)))).toBe(0);
  });

  it('ignores an altitude that is not a number', () => {
    expect(elevationGainMeters([NaN, 100, 104].map((alt, i) => at(alt, i)))).toBeCloseTo(4, 5);
    expect(elevationGainMeters([NaN, Infinity].map((alt, i) => at(alt, i)))).toBeNull();
  });

  it('never counts a steady descent', () => {
    const track = [120, 116, 112, 108].map((alt, i) => at(alt, i));
    expect(elevationGainMeters(track)).toBe(0);
  });

  it('skips fixes with no altitude and is unknown when none has one', () => {
    expect(elevationGainMeters([at(null, 0), at(100, 1), at(null, 2), at(104, 3)])).toBeCloseTo(4, 5);
    expect(elevationGainMeters([at(null, 0), at(null, 1)])).toBeNull();
    expect(elevationGainMeters([])).toBeNull();
  });
});

describe('netClimbMeters', () => {
  const at = (altitude: number | null, t: number) => fix(t, t, { altitudeMeters: altitude });

  it('is the last altitude minus the first, never below zero', () => {
    expect(netClimbMeters([at(100, 0), at(105, 1), at(112, 2)])).toBeCloseTo(12, 5);
    expect(netClimbMeters([at(112, 0), at(100, 1)])).toBe(0);
  });

  it('smooths the noisy ends of a longer track by the median of three readings at each end', () => {
    // A noisy 140 m start reading: the median of 100, 101, 140 is 101, and of 120, 121, 122 is 121.
    const track = [100, 101, 140, 120, 121, 122].map((alt, i) => at(alt, i));
    expect(netClimbMeters(track)).toBe(20);
  });

  it('ignores altitudes that are not numbers', () => {
    expect(netClimbMeters([NaN, 100, 110].map((alt, i) => at(alt, i)))).toBe(10);
  });

  it('is unknown without altitudes', () => {
    expect(netClimbMeters([at(null, 0), at(null, 1)])).toBeNull();
    expect(netClimbMeters([])).toBeNull();
  });
});

describe('estimateRunCaloriesKcal', () => {
  const run = { distanceMeters: 10000, movingSeconds: 3000, netClimbMeters: 0, weightKg: 70 };

  it('uses the ACSM running equation at and above 134 m/min', () => {
    // 200 m/min. VO2 = 0.2 x 200 + 3.5 = 43.5. kcal/min = 43.5 x 70 / 1000 x 5 = 15.225.
    // Over 50 min: 761.25, rounded to 761.
    expect(estimateRunCaloriesKcal(run)).toBe(761);
  });

  it('adds the grade term for a net climb', () => {
    // 100 m over 10 km is a 0.01 grade: VO2 = 43.5 + 0.9 x 200 x 0.01 = 45.3. 15.855 x 50 = 792.75.
    expect(estimateRunCaloriesKcal({ ...run, netClimbMeters: 100 })).toBe(793);
  });

  it('uses the walking equation below 134 m/min', () => {
    // 4 km in 50 min is 80 m/min. VO2 = 0.1 x 80 + 3.5 = 11.5. kcal/min = 4.025. Over 50 min: 201.25.
    expect(estimateRunCaloriesKcal({ ...run, distanceMeters: 4000 })).toBe(201);
  });

  it('switches equation exactly at the threshold', () => {
    expect(ACSM_RUNNING_THRESHOLD_M_PER_MIN).toBe(134);
    // 6,700 m in 50 min is exactly 134 m/min, so running: VO2 = 0.2 x 134 + 3.5 = 30.3.
    // kcal/min = 30.3 x 70 x 5 / 1000 = 10.605. Over 50 min: 530.25.
    expect(estimateRunCaloriesKcal({ ...run, distanceMeters: 6700 })).toBe(530);
  });

  it('adds the grade term to the walking equation too', () => {
    // 4 km in 50 min is 80 m/min; 100 m net climb is a 0.025 grade. VO2 = 0.1 x 80 + 1.8 x 80 x 0.025
    // + 3.5 = 15.1. kcal/min = 15.1 x 70 x 5 / 1000 = 5.285. Over 50 min: 264.25.
    expect(estimateRunCaloriesKcal({ ...run, distanceMeters: 4000, netClimbMeters: 100 })).toBe(264);
  });

  it('never lets a downhill lower the estimate, and ignores a non-numeric climb', () => {
    expect(estimateRunCaloriesKcal({ ...run, netClimbMeters: -50 })).toBe(761);
    expect(estimateRunCaloriesKcal({ ...run, netClimbMeters: NaN })).toBe(761);
  });

  it('has no estimate for a non-numeric weight, time or distance', () => {
    expect(estimateRunCaloriesKcal({ ...run, weightKg: NaN })).toBeNull();
    expect(estimateRunCaloriesKcal({ ...run, movingSeconds: NaN })).toBeNull();
    expect(estimateRunCaloriesKcal({ ...run, distanceMeters: Infinity })).toBeNull();
  });

  it('has no estimate without a weight, without moving time, or without distance', () => {
    expect(estimateRunCaloriesKcal({ ...run, weightKg: null })).toBeNull();
    expect(estimateRunCaloriesKcal({ ...run, weightKg: 0 })).toBeNull();
    expect(estimateRunCaloriesKcal({ ...run, movingSeconds: 0 })).toBeNull();
    expect(estimateRunCaloriesKcal({ ...run, distanceMeters: 0 })).toBeNull();
  });

  it('treats an unknown climb as flat', () => {
    expect(estimateRunCaloriesKcal({ ...run, netClimbMeters: null })).toBe(761);
  });
});

describe('averageHeartRate', () => {
  const samples = [
    { timestampMs: 1000, bpm: 140 },
    { timestampMs: 2000, bpm: 150 },
    { timestampMs: 3000, bpm: 160 },
    { timestampMs: 9000, bpm: 200 },
  ];

  it('averages the samples inside the window, inclusive at both ends', () => {
    expect(averageHeartRate(samples, 1000, 3000)).toBe(150);
  });

  it('rounds to a whole beat', () => {
    expect(averageHeartRate(samples.slice(0, 2), 1000, 2000)).toBe(145);
    expect(averageHeartRate([{ timestampMs: 1, bpm: 140 }, { timestampMs: 2, bpm: 141 }], 0, 10)).toBe(141);
  });

  it('is unknown when no sample falls in the window', () => {
    expect(averageHeartRate(samples, 4000, 8000)).toBeNull();
    expect(averageHeartRate([], 0, 10)).toBeNull();
  });
});

/**
 * Active calories for a run (docs/product/scan-height-age-plan.md §4.4). A watch reports *active*
 * energy, so the app's own estimate does too: gross energy minus resting energy over the run, with
 * resting from the latest scan's BMR (else 1 MET). Gross comes from Keytel et al. (J Sports Sci
 * 2005;23(3):289–297) when heart rate, age and sex are known, else from the ACSM pace equation.
 */
describe('estimateRunActiveCaloriesKcal', () => {
  // 10 km in 50 min at 70 kg: ACSM gross 15.225 kcal/min (see estimateRunCaloriesKcal above).
  const run = {
    distanceMeters: 10000,
    movingSeconds: 3000,
    netClimbMeters: 0,
    weightKg: 70,
    bmrKcal: null as number | null,
    avgHeartRateBpm: null as number | null,
    ageYears: null as number | null,
    sex: null as 'male' | 'female' | 'prefer_not_to_say' | null,
  };

  it("subtracts resting energy from ACSM's gross figure, using the scan's BMR", () => {
    // Resting 1,680 kcal / 1,440 min = 1.1667 kcal/min. (15.225 − 1.1667) × 50 = 702.9.
    expect(estimateRunActiveCaloriesKcal({ ...run, bmrKcal: 1680 })).toBe(703);
  });

  it('uses 1 MET (3.5 mL·kg⁻¹·min⁻¹) for resting energy without a scan', () => {
    // 1 MET at 70 kg = 3.5 × 70 / 1000 × 5 = 1.225 kcal/min. (15.225 − 1.225) × 50 = 700.
    expect(estimateRunActiveCaloriesKcal(run)).toBe(700);
  });

  it("uses Keytel's equation for men when heart rate, age and sex are known", () => {
    // −55.0969 + 0.6309 × 150 + 0.1988 × 70 + 0.2017 × 30 = 59.5051 kJ/min = 14.2221 kcal/min.
    // (14.2221 − 1.1667) × 50 = 652.8.
    expect(estimateRunActiveCaloriesKcal({ ...run, bmrKcal: 1680, avgHeartRateBpm: 150, ageYears: 30, sex: 'male' })).toBe(653);
  });

  it("uses Keytel's equation for women", () => {
    // −20.4022 + 0.4472 × 150 − 0.1263 × 60 + 0.074 × 30 = 41.3198 kJ/min = 9.8757 kcal/min.
    // Resting 1 MET at 60 kg = 1.05 kcal/min. (9.8757 − 1.05) × 50 = 441.3.
    expect(
      estimateRunActiveCaloriesKcal({ ...run, weightKg: 60, avgHeartRateBpm: 150, ageYears: 30, sex: 'female' }),
    ).toBe(441);
  });

  it('falls back to the pace equation when heart rate, age or sex is missing, or sex is not given', () => {
    const keytel = { ...run, avgHeartRateBpm: 150, ageYears: 30, sex: 'male' as const };
    expect(estimateRunActiveCaloriesKcal({ ...keytel, avgHeartRateBpm: null })).toBe(700);
    expect(estimateRunActiveCaloriesKcal({ ...keytel, ageYears: null })).toBe(700);
    expect(estimateRunActiveCaloriesKcal({ ...keytel, sex: null })).toBe(700);
    expect(estimateRunActiveCaloriesKcal({ ...keytel, sex: 'prefer_not_to_say' })).toBe(700);
  });

  it(`falls back below ${KEYTEL_MIN_HEART_RATE_BPM} bpm, where Keytel's equation was not fitted`, () => {
    expect(estimateRunActiveCaloriesKcal({ ...run, avgHeartRateBpm: 80, ageYears: 30, sex: 'male' })).toBe(700);
  });

  it('never goes below zero', () => {
    // 1 km in 50 min: ACSM walking gross 1.925 kcal/min, below a 3,000 kcal BMR's 2.083 kcal/min.
    expect(estimateRunActiveCaloriesKcal({ ...run, distanceMeters: 1000, bmrKcal: 3000 })).toBe(0);
  });

  it('cannot estimate without a weight or a moving time', () => {
    expect(estimateRunActiveCaloriesKcal({ ...run, weightKg: null })).toBeNull();
    expect(estimateRunActiveCaloriesKcal({ ...run, movingSeconds: 0 })).toBeNull();
  });
});
