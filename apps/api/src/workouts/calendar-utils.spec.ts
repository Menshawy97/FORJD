import {
  civilDateMs,
  civilDateString,
  countWeekStreak,
  localCalendarDate,
  weekStartOf,
} from "./calendar-utils";

describe("localCalendarDate", () => {
  it("formats an instant as YYYY-MM-DD in the given zone", () => {
    // 2024-03-01T12:00:00Z is unambiguously March 1st in every zone.
    const instant = new Date("2024-03-01T12:00:00Z");

    expect(localCalendarDate(instant, "UTC")).toBe("2024-03-01");
  });

  it("resolves to the previous calendar day west of UTC near midnight", () => {
    // 2024-03-01T02:00:00Z is still Feb 29th at 21:00 the evening before in New York.
    const instant = new Date("2024-03-01T02:00:00Z");

    expect(localCalendarDate(instant, "America/New_York")).toBe("2024-02-29");
  });

  it("resolves to the next calendar day east of UTC near midnight", () => {
    // 2024-03-01T23:00:00Z is already March 2nd at 08:00 in Tokyo.
    const instant = new Date("2024-03-01T23:00:00Z");

    expect(localCalendarDate(instant, "Asia/Tokyo")).toBe("2024-03-02");
  });
});

describe("civilDateMs / civilDateString", () => {
  it("round-trips a civil date through milliseconds", () => {
    expect(civilDateString(civilDateMs("2024-03-01"))).toBe("2024-03-01");
  });

  it("treats the civil date as UTC midnight, not a local instant", () => {
    expect(civilDateMs("2024-03-01")).toBe(Date.UTC(2024, 2, 1));
  });

  it("handles a leap-day date correctly", () => {
    expect(civilDateString(civilDateMs("2024-02-29"))).toBe("2024-02-29");
  });
});

describe("weekStartOf", () => {
  it("returns the same date when it is already a Monday", () => {
    // 2024-03-04 is a Monday.
    expect(weekStartOf("2024-03-04")).toBe("2024-03-04");
  });

  it("returns the preceding Monday for a mid-week date", () => {
    // 2024-03-06 is a Wednesday in the same week as 2024-03-04.
    expect(weekStartOf("2024-03-06")).toBe("2024-03-04");
  });

  it("returns the preceding Monday for a Sunday, not the next one", () => {
    // 2024-03-10 is a Sunday; getUTCDay() is Sunday-based (0), which this function must
    // rotate to Monday-based rather than reading literally.
    expect(weekStartOf("2024-03-10")).toBe("2024-03-04");
  });

  it("carries correctly across a month boundary", () => {
    // 2024-04-01 is a Monday, but the week containing 2024-04-02 (Tuesday) still starts
    // in April; 2024-03-31 (Sunday) belongs to the week starting 2024-03-25.
    expect(weekStartOf("2024-03-31")).toBe("2024-03-25");
    expect(weekStartOf("2024-04-02")).toBe("2024-04-01");
  });
});

describe("countWeekStreak", () => {
  it("returns 0 when neither the current nor the previous week was trained", () => {
    const trained = new Set<string>(["2024-02-05"]);

    expect(countWeekStreak(trained, "2024-03-04")).toBe(0);
  });

  it("counts the current week when it was trained, walking back consecutively", () => {
    const trained = new Set<string>(["2024-03-04", "2024-02-26", "2024-02-19"]);

    expect(countWeekStreak(trained, "2024-03-04")).toBe(3);
  });

  it("stays alive through an empty current week if last week was trained", () => {
    // Measured on a Monday morning before training, the current week is empty but the
    // streak should not have reset yet.
    const trained = new Set<string>(["2024-02-26", "2024-02-19"]);

    expect(countWeekStreak(trained, "2024-03-04")).toBe(2);
  });

  it("stops at the first gap", () => {
    const trained = new Set<string>(["2024-03-04", "2024-02-26", "2024-02-12"]);

    // 2024-02-19 is missing, so the streak stops after the two most recent weeks.
    expect(countWeekStreak(trained, "2024-03-04")).toBe(2);
  });

  it("returns 0 for a fully untrained history", () => {
    expect(countWeekStreak(new Set<string>(), "2024-03-04")).toBe(0);
  });
});
