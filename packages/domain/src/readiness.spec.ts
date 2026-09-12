import { computeReadiness, type ReadinessComponentKey, type ReadinessDailyReading } from "./readiness";

const ASOF = "2026-09-08";
/** Mirrors readiness.ts's own constant. The recent window is [asOf-6 .. asOf] (7 days); the
 *  baseline window is the 60 days immediately BEFORE that, non-overlapping -- ending at
 *  asOf-7. Both boundaries are pinned by their own dedicated tests below against the real
 *  module, so a drift between this mirror and the real constant would fail loudly there. */
const RECENT_WINDOW_DAYS = 7;

function daysAgoDate(asOf: string, daysAgo: number): string {
  const d = new Date(`${asOf}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** `count` daily readings ending on `endDate` (inclusive), oldest first. `valueFor(daysAgo)`
 *  is relative to `endDate`, not to `ASOF` -- callers building baseline-only fixtures pass
 *  `baselineEnd` as `endDate` so `daysAgo` counts backward from the start of the recent
 *  window, not from today. */
function daysEnding(endDate: string, count: number, valueFor: (daysAgo: number) => number): ReadinessDailyReading[] {
  const readings: ReadinessDailyReading[] = [];
  const end = new Date(`${endDate}T00:00:00.000Z`);
  for (let daysAgo = count - 1; daysAgo >= 0; daysAgo--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    readings.push({ date: d.toISOString().slice(0, 10), value: valueFor(daysAgo) });
  }
  return readings;
}

/** `count` days of baseline-window-only readings, ending on the newest day the baseline
 *  window can contain (`asOf` minus `RECENT_WINDOW_DAYS`) -- guaranteed not to overlap the
 *  recent window, however many days are requested (up to 60). */
function baselineDaysEnding(asOf: string, count: number, valueFor: (daysAgo: number) => number): ReadinessDailyReading[] {
  return daysEnding(daysAgoDate(asOf, RECENT_WINDOW_DAYS), count, valueFor);
}

/** The last `count` (<=7) days, ending on `asOf` -- the recent window. */
function recentDaysEnding(asOf: string, count: number, valueFor: (daysAgo: number) => number): ReadinessDailyReading[] {
  return daysEnding(asOf, count, valueFor);
}

/** All four components flat at a fixed value, with a full 60-day baseline and a full 7-day
 *  recent window -- the "everything is exactly at its own normal" fixture most tests start
 *  from. */
function flatReadings(value: number): Record<ReadinessComponentKey, ReadinessDailyReading[]> {
  const combined = [...baselineDaysEnding(ASOF, 60, () => value), ...recentDaysEnding(ASOF, 7, () => value)];
  return {
    hrv: combined.map((r) => ({ ...r })),
    resting_heart_rate: combined.map((r) => ({ ...r })),
    sleep_duration: combined.map((r) => ({ ...r })),
    respiratory_rate: combined.map((r) => ({ ...r })),
  };
}

describe("computeReadiness", () => {
  describe("withholding", () => {
    it("withholds the composite when a component has no readings at all", () => {
      const readings = flatReadings(60);
      const result = computeReadiness({ ...readings, sleep_duration: [] }, ASOF);

      expect(result.score).toBeNull();
      expect(result.zone).toBeNull();
      expect(result.withheldReason).toContain("sleep_duration");
    });

    it("withholds when baseline history is present but under MIN_BASELINE_DAYS (30)", () => {
      const readings = flatReadings(60);
      readings.hrv = [...baselineDaysEnding(ASOF, 20, () => 60), ...recentDaysEnding(ASOF, 7, () => 60)];

      const result = computeReadiness(readings, ASOF);
      expect(result.score).toBeNull();
      expect(result.withheldReason).toContain("hrv");
    });

    it("withholds when there is a full baseline but no reading in the recent window", () => {
      const readings = flatReadings(60);
      readings.hrv = baselineDaysEnding(ASOF, 60, () => 60); // baseline only, nothing recent

      const result = computeReadiness(readings, ASOF);
      expect(result.score).toBeNull();
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.recentValue).toBeNull();
    });

    it("still reports a component's raw recentValue even while withheld for lack of baseline history", () => {
      const readings = flatReadings(60);
      readings.hrv = [...baselineDaysEnding(ASOF, 10, () => 60), ...recentDaysEnding(ASOF, 7, () => 65)];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.score).toBeNull();
      expect(hrv?.recentValue).toBeCloseTo(65, 5);
    });
  });

  describe("scoring, all components fully baselined", () => {
    it("scores every component at 50 (neutral) and the composite at 50 when nothing deviates from baseline", () => {
      const result = computeReadiness(flatReadings(60), ASOF);

      expect(result.score).toBe(50);
      expect(result.zone).toBe("yellow");
      for (const component of result.components) {
        expect(component.score).toBeCloseTo(50, 5);
        expect(component.label).toBe("normal");
      }
    });

    it("scores a higher-is-better component (HRV) above 50 when recent values are above baseline", () => {
      const readings = flatReadings(60);
      readings.hrv = [...baselineDaysEnding(ASOF, 60, () => 60), ...recentDaysEnding(ASOF, 7, () => 90)];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.score).toBeGreaterThan(50);
      expect(hrv?.label).toBe("elevated");
    });

    it("scores a lower-is-better component (resting heart rate) below 50 when recent values are ABOVE baseline (worse)", () => {
      const readings = flatReadings(60);
      readings.resting_heart_rate = [
        ...baselineDaysEnding(ASOF, 60, () => 55),
        ...recentDaysEnding(ASOF, 7, () => 70),
      ];

      const result = computeReadiness(readings, ASOF);
      const rhr = result.components.find((c) => c.key === "resting_heart_rate");
      expect(rhr?.score).toBeLessThan(50);
      expect(rhr?.label).toBe("low");
    });

    it("scores a lower-is-better component ABOVE 50 when recent values are below baseline (better)", () => {
      const readings = flatReadings(60);
      readings.resting_heart_rate = [
        ...baselineDaysEnding(ASOF, 60, () => 55),
        ...recentDaysEnding(ASOF, 7, () => 48),
      ];

      const result = computeReadiness(readings, ASOF);
      const rhr = result.components.find((c) => c.key === "resting_heart_rate");
      expect(rhr?.score).toBeGreaterThan(50);
      expect(rhr?.label).toBe("elevated");
    });

    it("treats an identical recent-vs-baseline HRV value as zero deviation regardless of the log transform", () => {
      // ln(x) - ln(x) = 0 for any x -- a sanity check that the transform doesn't itself
      // introduce a bias when nothing has actually changed.
      const readings = flatReadings(45);

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.score).toBeCloseTo(50, 5);
      expect(hrv?.recentValue).toBeCloseTo(45, 5);
    });

    it("does not divide by zero when the baseline has no variance", () => {
      const result = computeReadiness(flatReadings(60), ASOF);
      for (const component of result.components) {
        expect(Number.isFinite(component.score)).toBe(true);
      }
    });
  });

  describe("zone boundaries (WHOOP's published cutoffs)", () => {
    it("composite <= 33 is red", () => {
      const flat = flatReadings(60);
      for (const key of ["hrv", "sleep_duration"] as const) {
        flat[key] = [...baselineDaysEnding(ASOF, 60, () => 60), ...recentDaysEnding(ASOF, 7, () => 10)];
      }
      for (const key of ["resting_heart_rate", "respiratory_rate"] as const) {
        flat[key] = [...baselineDaysEnding(ASOF, 60, () => 60), ...recentDaysEnding(ASOF, 7, () => 200)];
      }

      const result = computeReadiness(flat, ASOF);
      expect(result.score).not.toBeNull();
      expect(result.zone).toBe("red");
      expect((result.score as number) <= 33).toBe(true);
    });

    it("composite in the middle band is yellow", () => {
      const result = computeReadiness(flatReadings(60), ASOF);
      expect(result.zone).toBe("yellow");
    });

    it("composite > 66 is green", () => {
      const flat = flatReadings(60);
      for (const key of ["hrv", "sleep_duration"] as const) {
        flat[key] = [...baselineDaysEnding(ASOF, 60, () => 60), ...recentDaysEnding(ASOF, 7, () => 500)];
      }
      for (const key of ["resting_heart_rate", "respiratory_rate"] as const) {
        flat[key] = [...baselineDaysEnding(ASOF, 60, () => 60), ...recentDaysEnding(ASOF, 7, () => 5)];
      }

      const result = computeReadiness(flat, ASOF);
      expect(result.zone).toBe("green");
      expect((result.score as number) > 66).toBe(true);
    });
  });

  describe("window semantics", () => {
    it("excludes a reading older than the 60-day baseline window (67+ days before asOf)", () => {
      const readings = flatReadings(60);
      readings.hrv = [{ date: daysAgoDate(ASOF, 67), value: 999999 }, ...readings.hrv];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.score).toBeCloseTo(50, 5);
    });

    it("includes a reading dated exactly asOf-66 (the oldest day the baseline window can contain)", () => {
      const readings = flatReadings(60);
      // Baseline missing only its oldest possible day (asOf-66) -- 59 days, asOf-65..asOf-7.
      readings.hrv = [
        ...daysEnding(daysAgoDate(ASOF, 7), 59, () => 60),
        ...recentDaysEnding(ASOF, 7, () => 60),
      ];
      const before = computeReadiness(readings, ASOF).components.find((c) => c.key === "hrv");
      expect(before?.baselineDayCount).toBe(59);

      readings.hrv.push({ date: daysAgoDate(ASOF, 66), value: 60 });
      const after = computeReadiness(readings, ASOF).components.find((c) => c.key === "hrv");
      expect(after?.baselineDayCount).toBe(60);
    });

    it("excludes a reading dated exactly asOf-67 (one day older than the baseline window can reach)", () => {
      const readings = flatReadings(60);
      readings.hrv.push({ date: daysAgoDate(ASOF, 67), value: 60 });

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.baselineDayCount).toBe(60);
    });

    it("includes a reading dated exactly asOf-7 in the baseline window (its newest possible day)", () => {
      const readings = flatReadings(60);
      // Baseline missing only its newest possible day (asOf-7) -- 59 days, asOf-66..asOf-8.
      readings.hrv = [
        ...daysEnding(daysAgoDate(ASOF, 8), 59, () => 60),
        { date: daysAgoDate(ASOF, 7), value: 999999 },
        ...recentDaysEnding(ASOF, 7, () => 60),
      ];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.baselineDayCount).toBe(60);
      // The outlier at asOf-7 is IN the baseline, not the recent window -- it must move the
      // baseline mean/SD (and therefore the score) away from the neutral 50 a flat baseline
      // would otherwise produce, proving it was actually counted as a baseline day.
      expect(hrv?.score).not.toBeCloseTo(50, 1);
    });

    it("excludes a reading dated exactly asOf-6 from the baseline window (it belongs to the recent window instead)", () => {
      const readings = flatReadings(60);
      readings.hrv = [
        ...baselineDaysEnding(ASOF, 60, () => 60),
        { date: daysAgoDate(ASOF, 6), value: 60 },
        ...recentDaysEnding(ASOF, 6, () => 60), // days 0-5, since day 6 is supplied above
      ];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.baselineDayCount).toBe(60);
    });

    it("includes a reading dated exactly 6 days before asOf in the recent window", () => {
      const readings = flatReadings(60);
      readings.hrv = [
        ...baselineDaysEnding(ASOF, 60, () => 60),
        ...recentDaysEnding(ASOF, 7, (daysAgo) => (daysAgo === 6 ? 90 : 60)),
      ];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      // Six of the seven recent days at 60 and one (6 days ago) at 90 must pull the recent
      // mean away from a flat 60, proving day-6 was actually folded in.
      expect(hrv?.recentValue).not.toBeCloseTo(60, 1);
    });

    it("includes a reading dated exactly asOf itself in the recent window", () => {
      const readings = flatReadings(60);
      readings.hrv = [
        ...baselineDaysEnding(ASOF, 60, () => 60),
        ...recentDaysEnding(ASOF, 7, (daysAgo) => (daysAgo === 0 ? 90 : 60)),
      ];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.recentValue).not.toBeCloseTo(60, 1);
    });
  });

  describe("MIN_BASELINE_DAYS boundary (30)", () => {
    it("withholds at exactly 29 distinct baseline days", () => {
      const readings = flatReadings(60);
      readings.hrv = [...baselineDaysEnding(ASOF, 29, () => 60), ...recentDaysEnding(ASOF, 7, () => 60)];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.score).toBeNull();
      expect(hrv?.baselineDayCount).toBe(29);
    });

    it("scores at exactly 30 distinct baseline days", () => {
      const readings = flatReadings(60);
      readings.hrv = [...baselineDaysEnding(ASOF, 30, () => 60), ...recentDaysEnding(ASOF, 7, () => 60)];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.score).not.toBeNull();
      expect(hrv?.baselineDayCount).toBe(30);
    });
  });

  describe("duplicate same-day readings", () => {
    it("averages duplicate readings on the same date instead of double-counting the day", () => {
      const readings = flatReadings(60);
      // 15 distinct baseline days, each listed twice -- must count as 15 days, not 30, and
      // must therefore be withheld (below MIN_BASELINE_DAYS).
      const fifteenDays = baselineDaysEnding(ASOF, 15, () => 60);
      readings.hrv = [...fifteenDays, ...fifteenDays.map((r) => ({ ...r })), ...recentDaysEnding(ASOF, 7, () => 60)];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.baselineDayCount).toBe(15);
      expect(hrv?.score).toBeNull();
    });

    it("uses the mean of same-day duplicates as that day's value, not the first or last", () => {
      const readings = flatReadings(60);
      const recent = recentDaysEnding(ASOF, 7, () => 60);
      const recentDuplicates = recent.map((r) => ({ date: r.date, value: 80 }));
      readings.hrv = [...baselineDaysEnding(ASOF, 60, () => 60), ...recent, ...recentDuplicates];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      // Each recent day averages to (60+80)/2 = 70, not 60 or 80.
      expect(hrv?.recentValue).toBeCloseTo(70, 5);
    });
  });

  describe("SWC label boundary (0.5 baseline SD)", () => {
    it("labels exactly +0.5 SD as elevated (>= is inclusive), and just under as normal", () => {
      // Alternating baseline (raw HRV units -- scoreComponent applies ln() itself) gives a
      // known, non-zero SD in log-space, with no overlap between baseline and recent to
      // complicate the algebra (the whole reason the windows were made non-overlapping).
      const baseline = baselineDaysEnding(ASOF, 60, (daysAgo) => (daysAgo % 2 === 0 ? 40 : 60));
      const transformed = baseline.map((r) => Math.log(r.value));
      const baselineMean = transformed.reduce((a, b) => a + b, 0) / transformed.length;
      const sd = Math.sqrt(
        transformed.reduce((sum, x) => sum + (x - baselineMean) ** 2, 0) / (transformed.length - 1),
      );

      // Nudged 1e-6 past the boundary in each direction: hitting exactly 0.5*sd bit-for-bit
      // is not reliably achievable through this test's own independent mean+sd calculation
      // (floating-point addition is not associative, so `mean + 0.5*sd` and the production
      // code's own recomputation of the same baseline can differ in their last bit -- verified
      // numerically to round to 0.4999999999999994, not 0.5, for this exact fixture). 1e-6 is
      // many orders of magnitude larger than that noise floor while still meaning "at the
      // threshold" for any real physiological reading.
      const atThreshold = Math.exp(baselineMean + (0.5 + 1e-6) * sd);
      const justUnder = Math.exp(baselineMean + (0.5 - 1e-6) * sd);

      const atResult = computeReadiness(
        { ...flatReadings(60), hrv: [...baseline, ...recentDaysEnding(ASOF, 7, () => atThreshold)] },
        ASOF,
      );
      expect(atResult.components.find((c) => c.key === "hrv")?.label).toBe("elevated");

      const underResult = computeReadiness(
        { ...flatReadings(60), hrv: [...baseline, ...recentDaysEnding(ASOF, 7, () => justUnder)] },
        ASOF,
      );
      expect(underResult.components.find((c) => c.key === "hrv")?.label).toBe("normal");
    });

    it("labels exactly -0.5 SD as low, symmetrically", () => {
      const baseline = baselineDaysEnding(ASOF, 60, (daysAgo) => (daysAgo % 2 === 0 ? 55 : 65));
      const transformed = baseline.map((r) => r.value); // resting_heart_rate: no log transform
      const baselineMean = transformed.reduce((a, b) => a + b, 0) / transformed.length;
      const sd = Math.sqrt(
        transformed.reduce((sum, x) => sum + (x - baselineMean) ** 2, 0) / (transformed.length - 1),
      );
      // Lower-is-better: directedZ = -z, so directedZ <= -0.5 means z >= 0.5, i.e. the recent
      // RHR must be ABOVE baseline (worse) to earn the "low" (bad) label. Nudged 1e-6 past the
      // threshold for the same floating-point reason explained in the HRV test above (verified
      // numerically: `mean + 0.5*sd` for this exact fixture rounds to a z of
      // 0.4999999999999994, not 0.5).
      const atThreshold = baselineMean + (0.5 + 1e-6) * sd;

      const result = computeReadiness(
        { ...flatReadings(60), resting_heart_rate: [...baseline, ...recentDaysEnding(ASOF, 7, () => atThreshold)] },
        ASOF,
      );
      expect(result.components.find((c) => c.key === "resting_heart_rate")?.label).toBe("low");
    });
  });

  describe("all four components, mixed readiness", () => {
    it("names every unscored component, not just the first, in a deterministic key order", () => {
      const readings = flatReadings(60);
      const result = computeReadiness({ ...readings, hrv: [], resting_heart_rate: [] }, ASOF);
      expect(result.withheldReason).toBe(
        "Still building your baseline for: hrv, resting_heart_rate. Needs 30 days of history.",
      );
    });

    it("withholds the composite even when only ONE of the four components is unscoreable", () => {
      const readings = flatReadings(60);
      const result = computeReadiness({ ...readings, respiratory_rate: [] }, ASOF);
      expect(result.score).toBeNull();
      expect(result.withheldReason).toBe("Still building your baseline for: respiratory_rate. Needs 30 days of history.");
      // The three ready components still score individually even though the composite is withheld.
      expect(result.components.find((c) => c.key === "hrv")?.score).not.toBeNull();
    });
  });

  describe("saturation", () => {
    it("clamps an extreme deviation to a score of 100, not beyond", () => {
      const readings = flatReadings(60);
      readings.hrv = [...baselineDaysEnding(ASOF, 60, () => 60), ...recentDaysEnding(ASOF, 7, () => 1_000_000)];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.score).toBe(100);
    });

    it("clamps an extreme deviation to a score of 0, not below", () => {
      const readings = flatReadings(60);
      readings.resting_heart_rate = [
        ...baselineDaysEnding(ASOF, 60, () => 55),
        ...recentDaysEnding(ASOF, 7, () => 1_000_000),
      ];

      const result = computeReadiness(readings, ASOF);
      const rhr = result.components.find((c) => c.key === "resting_heart_rate");
      expect(rhr?.score).toBe(0);
    });
  });

  describe("zone/score consistency", () => {
    it("the returned zone always matches the returned (rounded) score's own band", () => {
      const readings = flatReadings(60);
      readings.hrv = [...baselineDaysEnding(ASOF, 60, () => 60), ...recentDaysEnding(ASOF, 7, () => 30)];
      readings.resting_heart_rate = [
        ...baselineDaysEnding(ASOF, 60, () => 55),
        ...recentDaysEnding(ASOF, 7, () => 90),
      ];

      const result = computeReadiness(readings, ASOF);
      expect(result.score).not.toBeNull();
      const score = result.score as number;
      const expectedZone = score <= 33 ? "red" : score <= 66 ? "yellow" : "green";
      expect(result.zone).toBe(expectedZone);
    });
  });

  describe("readings dated after asOf", () => {
    it("ignores a reading dated after asOf when computing the recent value", () => {
      const readings = flatReadings(60);
      readings.hrv = [
        ...baselineDaysEnding(ASOF, 60, () => 60),
        ...recentDaysEnding(ASOF, 7, () => 60),
        { date: daysAgoDate(ASOF, -5), value: 999999 }, // 5 days AFTER asOf
      ];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");
      expect(hrv?.recentValue).toBeCloseTo(60, 5);
      expect(hrv?.score).toBeCloseTo(50, 5);
    });
  });

  describe("a zero HRV value reaching the log transform (R10 guard)", () => {
    // packages/contracts now rejects zero at the write boundary for any log-transformed
    // metric, but this guard exists in case a bad value reaches the calculation anyway --
    // a stale ingested row, a bypassed validation path, a future caller that skips the
    // contract. `Math.log(0) === -Infinity`, and that propagates to `NaN` through the
    // baseline mean/variance/z-score chain -- this must never surface as a component or
    // composite score.
    it("never returns NaN or -Infinity for a component score when a baseline reading is zero", () => {
      const readings = flatReadings(60);
      readings.hrv = [...baselineDaysEnding(ASOF, 60, () => 0), ...recentDaysEnding(ASOF, 7, () => 60)];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");

      expect(Number.isFinite(hrv?.score ?? NaN) || hrv?.score === null).toBe(true);
      expect(Number.isNaN(hrv?.score)).toBe(false);
    });

    it("never returns NaN or -Infinity for a component score when the recent HRV reading is zero", () => {
      const readings = flatReadings(60);
      readings.hrv = [...baselineDaysEnding(ASOF, 60, () => 60), ...recentDaysEnding(ASOF, 7, () => 0)];

      const result = computeReadiness(readings, ASOF);
      const hrv = result.components.find((c) => c.key === "hrv");

      expect(Number.isFinite(hrv?.score ?? NaN) || hrv?.score === null).toBe(true);
      expect(Number.isNaN(hrv?.score)).toBe(false);
    });

    it("never lets a NaN component score poison the composite score", () => {
      const readings = flatReadings(60);
      readings.hrv = [...baselineDaysEnding(ASOF, 60, () => 0), ...recentDaysEnding(ASOF, 7, () => 0)];

      const result = computeReadiness(readings, ASOF);

      expect(result.score === null || Number.isFinite(result.score)).toBe(true);
    });
  });
});
