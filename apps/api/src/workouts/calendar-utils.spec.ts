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
  // Weeks run Saturday to Friday (ADR-056, the Egyptian calendar).
  it("returns the same date when it is already a Saturday", () => {
    // 2024-03-02 is a Saturday.
    expect(weekStartOf("2024-03-02")).toBe("2024-03-02");
  });

  it("returns the preceding Saturday for a mid-week date", () => {
    // 2024-03-06 is a Wednesday in the week that began Saturday 2024-03-02.
    expect(weekStartOf("2024-03-06")).toBe("2024-03-02");
  });

  it("keeps Sunday and Monday in the week that began the Saturday before", () => {
    // Under the old Monday-start rule, Sunday 2024-03-03 closed the previous week.
    expect(weekStartOf("2024-03-03")).toBe("2024-03-02");
    expect(weekStartOf("2024-03-04")).toBe("2024-03-02");
  });

  it("ends the week on Friday, the day before the next Saturday", () => {
    // 2024-03-08 is a Friday; 2024-03-09, a Saturday, starts the next week.
    expect(weekStartOf("2024-03-08")).toBe("2024-03-02");
    expect(weekStartOf("2024-03-09")).toBe("2024-03-09");
  });

  it("carries correctly across a month boundary", () => {
    // 2024-03-30 is a Saturday, so Monday 2024-04-01 belongs to a week that began in March.
    expect(weekStartOf("2024-04-01")).toBe("2024-03-30");
    expect(weekStartOf("2024-03-29")).toBe("2024-03-23");
  });
});

describe("countWeekStreak", () => {
  it("returns 0 when neither the current nor the previous week was trained", () => {
    const trained = new Set<string>(["2024-02-03"]);

    expect(countWeekStreak(trained, "2024-03-02")).toBe(0);
  });

  it("counts the current week when it was trained, walking back consecutively", () => {
    const trained = new Set<string>(["2024-03-02", "2024-02-24", "2024-02-17"]);

    expect(countWeekStreak(trained, "2024-03-02")).toBe(3);
  });

  it("stays alive through an empty current week if last week was trained", () => {
    // Measured on a Saturday morning before training, the current week is empty but the
    // streak should not have reset yet.
    const trained = new Set<string>(["2024-02-24", "2024-02-17"]);

    expect(countWeekStreak(trained, "2024-03-02")).toBe(2);
  });

  it("stops at the first gap", () => {
    const trained = new Set<string>(["2024-03-02", "2024-02-24", "2024-02-10"]);

    // 2024-02-17 is missing, so the streak stops after the two most recent weeks.
    expect(countWeekStreak(trained, "2024-03-02")).toBe(2);
  });

  it("returns 0 for a fully untrained history", () => {
    expect(countWeekStreak(new Set<string>(), "2024-03-02")).toBe(0);
  });
});
