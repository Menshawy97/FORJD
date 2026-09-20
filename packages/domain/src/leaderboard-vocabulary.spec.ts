import {
  LEADERBOARD_METRICS,
  LEADERBOARD_PERIODS,
  LEADERBOARD_STATUSES,
  LIVE_METRICS,
  MIN_COHORT_SIZE,
} from "./leaderboard-vocabulary";

describe("leaderboard vocabulary", () => {
  it("lists the four design chips with activity first", () => {
    expect(LEADERBOARD_METRICS).toEqual(["activity", "strength", "running", "hyrox"]);
  });

  it("lists the two periods the design's segmented control offers", () => {
    expect(LEADERBOARD_PERIODS).toEqual(["month", "all_time"]);
  });

  it("names every state the screen has to render", () => {
    expect(LEADERBOARD_STATUSES).toEqual([
      "ranked",
      "coming_soon",
      "not_opted_in",
      "no_city",
      "no_eligible_sessions",
      "cohort_too_small",
    ]);
  });

  it("requires five athletes before a city board is shown (ADR-046)", () => {
    expect(MIN_COHORT_SIZE).toBe(5);
  });

  it("marks only activity as having a real score today", () => {
    expect(LIVE_METRICS).toEqual(["activity"]);
    for (const metric of LIVE_METRICS) expect(LEADERBOARD_METRICS).toContain(metric);
  });
});
