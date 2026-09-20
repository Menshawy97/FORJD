import {
  ACTIVITY_SESSION_CAP_SECONDS,
  ACTIVITY_WEIGHTS,
  AthleteActivityInput,
  cappedWorkingMinutes,
  compareForRank,
  midRankPercentile,
  percentileRanker,
  rankWindow,
  roundToTenth,
  scoreCohort,
  topPercent,
  whoAdherencePoints,
} from "./leaderboard-scoring";

const athlete = (over: Partial<AthleteActivityInput> = {}): AthleteActivityInput => ({
  userId: "u1",
  workingMinutes: 0,
  strengthDays: 0,
  volumeKg: 0,
  distanceKm: 0,
  weeks: 4,
  firstStartedAtMs: 1_000,
  ...over,
});

describe("ACTIVITY_WEIGHTS", () => {
  it("splits 100 points into 40 aerobic + 10 bonus + 20 strength + 30 relative work", () => {
    expect(ACTIVITY_WEIGHTS).toEqual({ aerobic: 40, aerobicBonus: 10, strength: 20, work: 30 });
    const total = Object.values(ACTIVITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
});

describe("cappedWorkingMinutes", () => {
  it("adds sessions in minutes", () => {
    expect(cappedWorkingMinutes([3600, 1800])).toBe(90);
  });

  it("counts a session at exactly the cap in full", () => {
    expect(cappedWorkingMinutes([ACTIVITY_SESSION_CAP_SECONDS])).toBe(120);
  });

  it("clips a nine-hour paused session to two hours", () => {
    expect(cappedWorkingMinutes([9 * 3600])).toBe(120);
  });

  it("ignores negative and non-finite durations", () => {
    expect(cappedWorkingMinutes([-60, Number.NaN, 600])).toBe(10);
  });

  it("is zero for no sessions", () => {
    expect(cappedWorkingMinutes([])).toBe(0);
  });
});

describe("whoAdherencePoints", () => {
  it("is zero with no training", () => {
    expect(whoAdherencePoints({ workingMinutes: 0, strengthDays: 0, weeks: 4 })).toBe(0);
  });

  it("gives the full 40 aerobic points at exactly the WHO lower target (150 min/week)", () => {
    expect(whoAdherencePoints({ workingMinutes: 600, strengthDays: 0, weeks: 4 })).toBe(40);
  });

  it("gives half the aerobic points at half the target", () => {
    expect(whoAdherencePoints({ workingMinutes: 300, strengthDays: 0, weeks: 4 })).toBe(20);
  });

  it("adds the bonus across the 150-300 min band and tops out at 50 aerobic points", () => {
    expect(whoAdherencePoints({ workingMinutes: 900, strengthDays: 0, weeks: 4 })).toBe(45);
    expect(whoAdherencePoints({ workingMinutes: 1200, strengthDays: 0, weeks: 4 })).toBe(50);
    expect(whoAdherencePoints({ workingMinutes: 5000, strengthDays: 0, weeks: 4 })).toBe(50);
  });

  it("gives the full 20 strength points at two strength days per week", () => {
    expect(whoAdherencePoints({ workingMinutes: 0, strengthDays: 8, weeks: 4 })).toBe(20);
  });

  it("scales strength points linearly below the target and caps above it", () => {
    expect(whoAdherencePoints({ workingMinutes: 0, strengthDays: 4, weeks: 4 })).toBe(10);
    expect(whoAdherencePoints({ workingMinutes: 0, strengthDays: 30, weeks: 4 })).toBe(20);
  });

  it("tops out at 70", () => {
    expect(whoAdherencePoints({ workingMinutes: 9999, strengthDays: 99, weeks: 4 })).toBe(70);
  });

  it("scales the targets with the window length", () => {
    expect(whoAdherencePoints({ workingMinutes: 150, strengthDays: 2, weeks: 1 })).toBe(60);
    expect(whoAdherencePoints({ workingMinutes: 150, strengthDays: 2, weeks: 2 })).toBe(30);
  });

  it("treats a window shorter than a week as one week so nobody divides by zero", () => {
    expect(whoAdherencePoints({ workingMinutes: 150, strengthDays: 0, weeks: 0 })).toBe(40);
  });
});

describe("midRankPercentile", () => {
  it("is zero for a value of zero, however many others are also zero", () => {
    expect(midRankPercentile(0, [0, 0, 0])).toBe(0);
  });

  it("puts the lone top value of five at 0.9", () => {
    expect(midRankPercentile(50, [10, 20, 30, 40, 50])).toBeCloseTo(0.9);
  });

  it("puts the lowest non-zero value of five at 0.1", () => {
    expect(midRankPercentile(10, [10, 20, 30, 40, 50])).toBeCloseTo(0.1);
  });

  it("gives tied athletes the same middle percentile", () => {
    expect(midRankPercentile(20, [10, 20, 20, 30])).toBeCloseTo(0.5);
  });

  it("ranks only among athletes who did some of the thing, so zeros do not pad the cohort", () => {
    expect(midRankPercentile(5, [0, 0, 5])).toBeCloseTo(0.5);
  });

  it("is zero for a negative or non-finite value and ignores non-finite cohort entries", () => {
    expect(midRankPercentile(-3, [1, 2])).toBe(0);
    expect(midRankPercentile(Number.NaN, [1, 2])).toBe(0);
    expect(midRankPercentile(5, [Number.NaN, Number.POSITIVE_INFINITY, 5])).toBeCloseTo(0.5);
  });

  it("is zero when nobody in the cohort did any", () => {
    expect(midRankPercentile(5, [])).toBe(0);
  });
});

describe("percentileRanker", () => {
  it("agrees with midRankPercentile on every value when the participation floor is 1", () => {
    const cohort = [0, 3, 3, 8, 0, 21, 21, 21, 55];
    const rank = percentileRanker(cohort, 1);
    for (const value of [0, 1, 3, 8, 20, 21, 55, 99]) {
      expect(rank(value)).toBeCloseTo(midRankPercentile(value, cohort));
    }
  });

  it("scores nothing for a modality fewer than the floor of athletes actually did", () => {
    // One person logging 100 m in a lifting city must not collect most of the work points.
    const rank = percentileRanker([0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1], 5);
    expect(rank(0.1)).toBe(0);
  });

  it("scores a modality once enough athletes did it", () => {
    const rank = percentileRanker([1, 2, 3, 4, 5], 5);
    expect(rank(5)).toBeCloseTo(0.9);
  });

  it("defaults the floor to the minimum cohort size", () => {
    expect(percentileRanker([1, 2, 3, 4])(4)).toBe(0);
    expect(percentileRanker([1, 2, 3, 4, 5])(5)).toBeGreaterThan(0);
  });
});

describe("roundToTenth", () => {
  it("rounds half up even when float noise sits just under the boundary", () => {
    expect(30 * 0.045 * 10).toBeLessThan(13.5); // the noise this guards against
    expect(roundToTenth(30 * 0.045)).toBe(1.4);
  });

  it("rounds ordinary values to one decimal", () => {
    expect(roundToTenth(92.66)).toBe(92.7);
    expect(roundToTenth(50)).toBe(50);
  });
});

describe("scoreCohort", () => {
  it("returns nothing for an empty cohort", () => {
    expect(scoreCohort([])).toEqual([]);
  });

  it("gives an athlete who did nothing a zero score", () => {
    const [only] = scoreCohort([athlete()]);
    expect(only?.score).toBe(0);
  });

  it("orders by score descending and numbers ranks 1..n with no shared ranks", () => {
    const ranked = scoreCohort([
      athlete({ userId: "low", workingMinutes: 60 }),
      athlete({ userId: "high", workingMinutes: 600, strengthDays: 8, volumeKg: 9000 }),
      athlete({ userId: "mid", workingMinutes: 300, strengthDays: 4, volumeKg: 3000 }),
    ]);
    expect(ranked.map((r) => r.userId)).toEqual(["high", "mid", "low"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("lets a runner earn the work points on distance with no lifting at all", () => {
    const ranked = scoreCohort(
      [10, 20, 30, 40, 120].map((km, i) =>
        athlete({ userId: `r${i}`, workingMinutes: 600, distanceKm: km }),
      ),
    );
    const scoreOf = (id: string): number => {
      const found = ranked.find((r) => r.userId === id);
      if (!found) throw new Error(`missing ${id}`);
      return found.score;
    };
    expect(scoreOf("r4")).toBeGreaterThan(scoreOf("r0"));
  });

  it("takes the best modality, so a lifter is not penalised for having no distance", () => {
    // Five lifters (the participation floor), nobody with distance and equal minutes: the top
    // lifter's best percentile is volume, (4 + 0.5) / 5 = 0.9, so 27 work points and no WHO points.
    const ranked = scoreCohort(
      [1000, 2000, 3000, 4000, 4608].map((kg, i) => athlete({ userId: `l${i}`, volumeKg: kg })),
    );
    expect(ranked[0]?.userId).toBe("l4");
    expect(ranked[0]?.score).toBe(27);
  });

  it("does not let a token amount of a rare modality outscore a real one", () => {
    // Ten lifters and one person who logged 100 m: the rare modality is under the floor, so
    // it earns nothing, and the strongest lifter still leads.
    const lifters = Array.from({ length: 10 }, (_, i) =>
      athlete({ userId: `l${i}`, volumeKg: 1000 * (i + 1) }),
    );
    const jogger = athlete({ userId: "jogger", distanceKm: 0.1 });
    const ranked = scoreCohort([...lifters, jogger]);
    expect(ranked[0]?.userId).toBe("l9");
    expect(ranked.find((r) => r.userId === "jogger")?.score).toBe(0);
  });

  it("breaks a score tie inside the cohort on the earlier start", () => {
    const ranked = scoreCohort([
      athlete({ userId: "late", workingMinutes: 300, firstStartedAtMs: 9_000 }),
      athlete({ userId: "early", workingMinutes: 300, firstStartedAtMs: 1_000 }),
    ]);
    expect(ranked.map((r) => r.userId)).toEqual(["early", "late"]);
  });

  it("ranks the same regardless of the order the athletes arrive in", () => {
    const rows = ["a", "b", "c", "d", "e", "f"].map((id, i) =>
      athlete({ userId: id, workingMinutes: 60 * (i + 1), volumeKg: 500 * ((i * 7) % 6) }),
    );
    const forward = scoreCohort(rows).map((r) => r.userId);
    const backward = scoreCohort([...rows].reverse()).map((r) => r.userId);
    expect(backward).toEqual(forward);
  });

  it("survives non-finite and negative inputs without corrupting the order", () => {
    const ranked = scoreCohort([
      athlete({ userId: "good", workingMinutes: 600, strengthDays: 8 }),
      athlete({
        userId: "bad",
        workingMinutes: Number.NaN,
        strengthDays: -4,
        volumeKg: Number.NEGATIVE_INFINITY,
        distanceKm: Number.NaN,
        weeks: Number.NaN,
        firstStartedAtMs: Number.POSITIVE_INFINITY,
      }),
      athlete({ userId: "worse", firstStartedAtMs: Number.POSITIVE_INFINITY }),
    ]);
    for (const r of ranked) expect(Number.isFinite(r.score)).toBe(true);
    expect(ranked.map((r) => r.userId)).toEqual(["good", "bad", "worse"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("scores a large city quickly", () => {
    const city = Array.from({ length: 10_000 }, (_, i) =>
      athlete({
        userId: `u${i}`,
        workingMinutes: (i * 37) % 900,
        strengthDays: i % 9,
        volumeKg: (i * 91) % 20_000,
        distanceKm: (i * 13) % 300,
      }),
    );
    const started = Date.now();
    const ranked = scoreCohort(city);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(ranked).toHaveLength(10_000);
  });

  it("keeps the score within 0..100", () => {
    const [top] = scoreCohort([
      athlete({ userId: "a", workingMinutes: 99999, strengthDays: 99, volumeKg: 1e9, distanceKm: 1e9 }),
    ]);
    expect(top?.score).toBeLessThanOrEqual(100);
    expect(top?.score).toBeGreaterThanOrEqual(0);
  });

  it("rounds the score to one decimal", () => {
    const ranked = scoreCohort([
      athlete({ userId: "a", workingMinutes: 333, strengthDays: 3, volumeKg: 100 }),
      athlete({ userId: "b", workingMinutes: 100, volumeKg: 50 }),
      athlete({ userId: "c", workingMinutes: 50, volumeKg: 10 }),
    ]);
    for (const r of ranked) expect(Math.abs(r.score * 10 - Math.round(r.score * 10))).toBeLessThan(1e-9);
  });

  it("does not mutate its input", () => {
    const input = [athlete({ userId: "a", volumeKg: 5 }), athlete({ userId: "b", volumeKg: 9 })];
    const snapshot = JSON.stringify(input);
    scoreCohort(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("gives two athletes with identical numbers the same score but different ranks", () => {
    const ranked = scoreCohort([
      athlete({ userId: "b", workingMinutes: 300, volumeKg: 100 }),
      athlete({ userId: "a", workingMinutes: 300, volumeKg: 100 }),
    ]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.score).toBeDefined();
    expect(ranked[0]?.score).toBe(ranked[1]?.score);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
    expect(ranked.map((r) => r.userId)).toEqual(["a", "b"]);
  });
});

describe("compareForRank", () => {
  const base = { userId: "a", score: 50, strengthDays: 4, workingMinutes: 300, firstStartedAtMs: 1_000 };

  it("puts the higher score first", () => {
    expect(compareForRank({ ...base, score: 60 }, base)).toBeLessThan(0);
    expect(compareForRank(base, { ...base, score: 60 })).toBeGreaterThan(0);
  });

  it("breaks a score tie on more strength days", () => {
    expect(compareForRank({ ...base, strengthDays: 5 }, base)).toBeLessThan(0);
  });

  it("then on more working minutes", () => {
    expect(compareForRank({ ...base, workingMinutes: 400 }, base)).toBeLessThan(0);
  });

  it("then on the earlier first session in the window", () => {
    expect(compareForRank({ ...base, firstStartedAtMs: 500 }, base)).toBeLessThan(0);
  });

  it("finally on user id, so the order is total", () => {
    expect(compareForRank({ ...base, userId: "a" }, { ...base, userId: "b" })).toBeLessThan(0);
    expect(compareForRank({ ...base, userId: "b" }, { ...base, userId: "a" })).toBeGreaterThan(0);
  });

  it("is zero only for the very same athlete", () => {
    expect(compareForRank(base, { ...base })).toBe(0);
  });

  it("yields the same order however a fixture is shuffled", () => {
    const rows = [
      { ...base, userId: "d", score: 40 },
      { ...base, userId: "c" },
      { ...base, userId: "b", strengthDays: 6 },
      { ...base, userId: "a", score: 90 },
    ];
    const expected = ["a", "b", "c", "d"];
    const shuffles = [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [1, 3, 0, 2],
      [2, 0, 3, 1],
    ];
    for (const order of shuffles) {
      const sorted = order.map((i) => rows[i]).sort((x, y) => compareForRank(x!, y!));
      expect(sorted.map((r) => r?.userId)).toEqual(expected);
    }
  });
});

describe("topPercent", () => {
  it("is 8 for 47th of 588", () => {
    expect(topPercent(47, 588)).toBe(8);
  });

  it("is never less than 1", () => {
    expect(topPercent(1, 1000)).toBe(1);
  });

  it("is 100 for last place", () => {
    expect(topPercent(20, 20)).toBe(100);
  });

  it("rounds up", () => {
    expect(topPercent(1, 3)).toBe(34);
  });

  it("stays finite for an empty cohort rather than returning Infinity", () => {
    expect(topPercent(1, 0)).toBe(100);
  });
});

describe('rankWindow', () => {
  it('centres the window on the athlete', () => {
    expect(rankWindow(47, 588, 3)).toEqual({ from: 44, to: 50 });
  });

  it('gives just the athlete for a window of zero', () => {
    expect(rankWindow(47, 588, 0)).toEqual({ from: 47, to: 47 });
  });

  it('back-fills at the top so the row count stays stable: 2nd with 3 either side is 1..7, not 1..5', () => {
    expect(rankWindow(2, 588, 3)).toEqual({ from: 1, to: 7 });
    expect(rankWindow(1, 588, 3)).toEqual({ from: 1, to: 7 });
  });

  it('back-fills at the bottom too', () => {
    expect(rankWindow(587, 588, 3)).toEqual({ from: 582, to: 588 });
    expect(rankWindow(588, 588, 3)).toEqual({ from: 582, to: 588 });
  });

  it('shows everyone when the whole city fits in the window', () => {
    expect(rankWindow(3, 6, 3)).toEqual({ from: 1, to: 6 });
    expect(rankWindow(1, 1, 3)).toEqual({ from: 1, to: 1 });
  });

  it('is exactly the window when the city is exactly that big', () => {
    expect(rankWindow(4, 7, 3)).toEqual({ from: 1, to: 7 });
  });

  it('always contains the athlete and always fits inside the city', () => {
    for (let cohort = 1; cohort <= 40; cohort += 1) {
      for (let rank = 1; rank <= cohort; rank += 1) {
        for (const window of [0, 1, 3, 10]) {
          const { from, to } = rankWindow(rank, cohort, window);
          expect(from).toBeLessThanOrEqual(rank);
          expect(to).toBeGreaterThanOrEqual(rank);
          expect(from).toBeGreaterThanOrEqual(1);
          expect(to).toBeLessThanOrEqual(cohort);
          expect(to - from + 1).toBe(Math.min(cohort, 2 * window + 1));
        }
      }
    }
  });
});
