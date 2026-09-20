import { formatSummary } from "./snapshot";

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
