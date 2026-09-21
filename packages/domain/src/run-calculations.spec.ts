import {
  ACSM_RUNNING_THRESHOLD_M_PER_MIN,
  acceptFix,
  averageHeartRate,
  averagePaceSecondsPerKm,
  buildTrack,
  currentSpeedMetersPerSecond,
  elevationGainMeters,
  estimateRunCaloriesKcal,
  haversineMeters,
  netClimbMeters,
  RunFix,
  splitsFromTrack,
  trackDistanceMeters,
} from './run-calculations';

// One degree of latitude on the mean-radius sphere (R = 6,371,000 m) is 111,194.93 m.
const METERS_PER_DEGREE = 111194.93;

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

  it('accepts a fix with unknown accuracy, since it cannot be judged', () => {
    expect(acceptFix(null, fix(0, 0, { accuracyMeters: null }))).toBe(true);
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
