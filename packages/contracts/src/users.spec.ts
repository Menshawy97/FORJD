import { setDateOfBirthRequestSchema, updateProfileRequestSchema } from "./users";

/** A `YYYY-MM-DD` string `years` years and `extraDays` days before today, in local time. */
function dateYearsAgo(years: number, extraDays = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear() - years, now.getMonth(), now.getDate() - extraDays);
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * ADR-042 -- the age gate is enforced on the server by refusing to store a date of birth that
 * makes someone younger than 16, and by never letting one be cleared back to null. A user who
 * passed the gate at sign-up must not be able to walk around it by editing their profile.
 */
describe("setDateOfBirthRequestSchema", () => {
  it("accepts a real YYYY-MM-DD date, without judging the age (the service decides that)", () => {
    expect(setDateOfBirthRequestSchema.safeParse({ dateOfBirth: dateYearsAgo(10) }).success).toBe(true);
    expect(setDateOfBirthRequestSchema.safeParse({ dateOfBirth: dateYearsAgo(30) }).success).toBe(true);
  });

  it("rejects a date that does not exist", () => {
    expect(setDateOfBirthRequestSchema.safeParse({ dateOfBirth: "2026-13-40" }).success).toBe(false);
  });

  it("rejects a wrong format and a missing value", () => {
    expect(setDateOfBirthRequestSchema.safeParse({ dateOfBirth: "19/09/2000" }).success).toBe(false);
    expect(setDateOfBirthRequestSchema.safeParse({}).success).toBe(false);
    expect(setDateOfBirthRequestSchema.safeParse({ dateOfBirth: null }).success).toBe(false);
  });

  it("rejects a date of birth in the future", () => {
    expect(setDateOfBirthRequestSchema.safeParse({ dateOfBirth: dateYearsAgo(0, -1) }).success).toBe(false);
  });
});

describe("updateProfileRequestSchema.dateOfBirth", () => {
  it("accepts someone who is 16 or older", () => {
    expect(updateProfileRequestSchema.safeParse({ dateOfBirth: dateYearsAgo(16) }).success).toBe(true);
    expect(updateProfileRequestSchema.safeParse({ dateOfBirth: dateYearsAgo(40) }).success).toBe(true);
  });

  it("rejects a date that would make the account holder younger than 16", () => {
    expect(updateProfileRequestSchema.safeParse({ dateOfBirth: dateYearsAgo(16, -1) }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ dateOfBirth: dateYearsAgo(10) }).success).toBe(false);
  });

  it("no longer allows clearing the date of birth back to null", () => {
    expect(updateProfileRequestSchema.safeParse({ dateOfBirth: null }).success).toBe(false);
  });

  it("still allows a profile update that leaves the date of birth alone", () => {
    expect(updateProfileRequestSchema.safeParse({ displayName: "Ada" }).success).toBe(true);
  });
});
