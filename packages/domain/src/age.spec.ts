import { ageInYears, isOldEnough, MINIMUM_AGE_YEARS } from "./age";

// Dates are built with the local constructor on purpose: `ageInYears` compares calendar
// parts, so a fixture must not depend on the machine's timezone.
const day = (year: number, month: number, dayOfMonth: number): Date => new Date(year, month - 1, dayOfMonth);

describe("MINIMUM_AGE_YEARS", () => {
  it("is 16 -- the age FORJD requires (ADR-042); change it here and everything follows", () => {
    expect(MINIMUM_AGE_YEARS).toBe(16);
  });
});

describe("ageInYears", () => {
  it("counts a birthday that falls exactly today as already reached", () => {
    expect(ageInYears("2010-09-19", day(2026, 9, 19))).toBe(16);
  });

  it("is one year less the day before the birthday", () => {
    expect(ageInYears("2010-09-20", day(2026, 9, 19))).toBe(15);
  });

  it("is a year more the day after the birthday", () => {
    expect(ageInYears("2010-09-18", day(2026, 9, 19))).toBe(16);
  });

  it("handles a birthday later in the same calendar month", () => {
    expect(ageInYears("2000-09-30", day(2026, 9, 19))).toBe(25);
  });

  it("handles a birthday earlier in a later month", () => {
    expect(ageInYears("2000-12-01", day(2026, 9, 19))).toBe(25);
    expect(ageInYears("2000-01-01", day(2026, 9, 19))).toBe(26);
  });

  it("treats a 29 February birthday as not yet reached on 28 February of a non-leap year", () => {
    expect(ageInYears("2008-02-29", day(2026, 2, 28))).toBe(17);
  });

  it("treats a 29 February birthday as reached on 1 March of a non-leap year", () => {
    expect(ageInYears("2008-02-29", day(2026, 3, 1))).toBe(18);
  });

  it("is 0 for someone born today", () => {
    expect(ageInYears("2026-09-19", day(2026, 9, 19))).toBe(0);
  });

  it("throws on a value that is not a calendar date, rather than guessing", () => {
    expect(() => ageInYears("not-a-date", day(2026, 9, 19))).toThrow("ageInYears");
    expect(() => ageInYears("2026-13-40", day(2026, 9, 19))).toThrow("ageInYears");
  });
});

describe("isOldEnough", () => {
  it("is true on the 16th birthday and false the day before", () => {
    expect(isOldEnough("2010-09-19", day(2026, 9, 19))).toBe(true);
    expect(isOldEnough("2010-09-20", day(2026, 9, 19))).toBe(false);
  });

  it("is false for a date of birth in the future", () => {
    expect(isOldEnough("2030-01-01", day(2026, 9, 19))).toBe(false);
  });
});
