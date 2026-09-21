import { describeError, formatSummary } from "./snapshot";

describe("formatSummary", () => {
  it("is one line when every city was captured", () => {
    expect(formatSummary({ cities: 3, rows: 42, failures: [] })).toBe("captured 3 cities (42 rows)\n");
  });

  it("names each city that failed and why", () => {
    const text = formatSummary({
      cities: 1,
      rows: 10,
      failures: [
        { citySlug: "cairo-eg-360630", message: "boom" },
        { citySlug: "oslo-no-3143244", message: "timeout" },
      ],
    });

    expect(text).toBe("captured 1 cities (10 rows), 2 failed:\n  cairo-eg-360630: boom\n  oslo-no-3143244: timeout\n");
  });
});

// Drizzle's "Failed query" error keeps the Postgres error on `cause`, and `error.stack` never
// prints it: production's snapshot failed on 2026-09-21 with only the SQL text to go on.
describe("describeError", () => {
  it("prints the Postgres error a drizzle query failure wraps", () => {
    const pgError = Object.assign(new Error("column ps.location_for_leaderboard does not exist"), {
      code: "42703",
    });
    const drizzleError = new Error("Failed query: select ws.city_slug from workout_sessions ws\nparams: 5", {
      cause: pgError,
    });

    const text = describeError(drizzleError);

    expect(text).toContain("Failed query");
    expect(text).toContain("caused by: column ps.location_for_leaderboard does not exist (code 42703)");
  });

  it("includes a Postgres detail line when there is one", () => {
    const pgError = Object.assign(new Error("insert violates a constraint"), {
      code: "23505",
      detail: "Key (id)=(x) already exists.",
    });

    expect(describeError(new Error("Failed query", { cause: pgError }))).toContain(
      "caused by: insert violates a constraint (code 23505) Key (id)=(x) already exists.",
    );
  });

  it("follows a chain of causes and stops on a cycle", () => {
    const inner = new Error("inner");
    const middle = new Error("middle", { cause: inner });
    const outer = new Error("outer", { cause: middle });
    (inner as { cause?: unknown }).cause = outer;

    const text = describeError(outer);

    expect(text).toContain("caused by: middle");
    expect(text).toContain("caused by: inner");
    expect(text).not.toContain("caused by: outer");
  });

  it("describes a cause that is not an Error", () => {
    expect(describeError(new Error("outer", { cause: "socket hang up" }))).toContain("caused by: socket hang up");
  });

  it("describes a thrown non-error value", () => {
    expect(describeError("plain string")).toBe("plain string");
  });
});
