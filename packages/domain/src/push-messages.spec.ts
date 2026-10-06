import { buildPrPush, buildRankPush, type PrRecord } from "./push-messages";

// Phase 12F slice 3a, ADR-061 (what a notification may say). One builder per kind, and each has a test that feeds it a
// fixture full of health values and checks that none of them can appear in the title, the body or the data. Push text
// passes through Expo and Google or Apple and can sit on a lock screen: a training fact the person published is allowed
// (an exercise name, a city), a health value never is.
const HEALTH = {
  weightKg: "ZZ-WEIGHT-81.4",
  heartRate: "ZZ-HR-142",
  hrv: "ZZ-HRV-91",
  sleep: "ZZ-SLEEP-5h12",
  calories: "ZZ-KCAL-2310",
  bodyFat: "ZZ-BODYFAT-14.2",
  readiness: "ZZ-READINESS-33",
};
const everythingTheBuilderMustNotEcho = Object.values(HEALTH);

/** The exact text a person would see, plus the data the app reads. */
const allText = (message: { title: string; body: string; data: Record<string, string> }): string =>
  JSON.stringify([message.title, message.body, message.data]);

describe("buildPrPush", () => {
  const lift = (exerciseName: string): PrRecord => ({ type: "lift", exerciseName });

  it("names the exercise for one lift", () => {
    expect(buildPrPush({ sessionId: "s1", records: [lift("Back Squat")] })).toEqual({
      title: "New PR on Back Squat",
      body: "Open FORJD to see it.",
      data: { type: "pr", sessionId: "s1" },
    });
  });

  it("says which kind of run record it is, with no figures", () => {
    expect(buildPrPush({ sessionId: "r1", records: [{ type: "run", record: "longest_run" }] })!.title).toBe("New PR: your longest run");
    expect(buildPrPush({ sessionId: "r1", records: [{ type: "run", record: "fastest_pace" }] })!.title).toBe("New PR: your fastest pace");
  });

  it("counts several records in one session instead of listing them", () => {
    const message = buildPrPush({ sessionId: "s1", records: [lift("Back Squat"), lift("Deadlift"), { type: "run", record: "longest_run" }] })!;

    expect(message.title).toBe("3 new PRs in that session");
    expect(message.body).toBe("Open FORJD to see them.");
  });

  it("returns nothing when there is no record to celebrate", () => {
    expect(buildPrPush({ sessionId: "s1", records: [] })).toBeNull();
  });

  it("cleans an exercise name: trims it, drops control characters and keeps a long one to a sensible length", () => {
    expect(buildPrPush({ sessionId: "s1", records: [lift("  Bench\u0000 Press\n")] })!.title).toBe("New PR on Bench Press");
    const long = buildPrPush({ sessionId: "s1", records: [lift("x".repeat(200))] })!.title;
    expect(long.length).toBeLessThanOrEqual("New PR on ".length + 60);
    expect(long.endsWith("…")).toBe(true);
    expect(buildPrPush({ sessionId: "s1", records: [lift("   ")] })!.title).toBe("New PR on a lift");
  });

  it("turns a newline or a tab into a space instead of gluing two words together", () => {
    expect(buildPrPush({ sessionId: "s1", records: [lift("Bench\nPress")] })!.title).toBe("New PR on Bench Press");
    expect(buildPrPush({ sessionId: "s1", records: [lift("Bench\tPress\r\nDay")] })!.title).toBe("New PR on Bench Press Day");
  });

  it("removes zero-width characters and the bidirectional overrides that could reorder a lock-screen title", () => {
    expect(buildPrPush({ sessionId: "s1", records: [lift("\u202eEvil\u202c Squat")] })!.title).toBe("New PR on Evil Squat");
    expect(buildPrPush({ sessionId: "s1", records: [lift("Back\u200bSquat\ufeff")] })!.title).toBe("New PR on BackSquat");
    expect(buildPrPush({ sessionId: "s1", records: [lift("Bench\u0085Press")] })!.title).toBe("New PR on BenchPress");
  });

  it("cuts a long name by whole characters, never through the middle of an emoji", () => {
    const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
    const name = `${"x".repeat(58)}😀yyy`;

    const title = buildPrPush({ sessionId: "s1", records: [lift(name)] })!.title;

    expect(title).toBe(`New PR on ${"x".repeat(58)}😀…`);
    expect(loneSurrogate.test(title)).toBe(false);
  });

  it("carries only the kind and the session id in the data, so the app fetches the details after it opens", () => {
    const message = buildPrPush({ sessionId: "s1", records: [lift("Back Squat")] })!;

    expect(Object.keys(message.data).sort()).toEqual(["sessionId", "type"]);
  });

  it("never lets a health value into the title, the body or the data, whatever it is handed", () => {
    // The builder's input type has no place for health values; this hands it some anyway (as a careless caller or a
    // later change might) and proves they cannot come out.
    const input = { sessionId: "s1", records: [lift("Back Squat")], ...HEALTH } as unknown as Parameters<typeof buildPrPush>[0];
    const records = [{ ...lift("Back Squat"), ...HEALTH }] as unknown as PrRecord[];

    for (const message of [buildPrPush(input)!, buildPrPush({ sessionId: "s1", records })!]) {
      const text = allText(message);
      for (const value of everythingTheBuilderMustNotEcho) expect(text).not.toContain(value);
    }
  });
});

describe("buildRankPush", () => {
  it("says the person moved up or down in their city, with no number", () => {
    expect(buildRankPush({ direction: "up", cityName: "Cairo", weekStart: "2026-10-10" })).toEqual({
      title: "You moved up in Cairo",
      body: "See the leaderboard.",
      data: { type: "rank", weekStart: "2026-10-10" },
    });
    expect(buildRankPush({ direction: "down", cityName: "Cairo", weekStart: "2026-10-10" }).title).toBe("You moved down in Cairo");
  });

  it("cleans the city name, and falls back to a plain phrase when there is none", () => {
    expect(buildRankPush({ direction: "up", cityName: "  Alexandria\u0007 ", weekStart: "2026-10-10" }).title).toBe("You moved up in Alexandria");
    expect(buildRankPush({ direction: "up", cityName: "   ", weekStart: "2026-10-10" }).title).toBe("You moved up in your city");
  });

  it("carries only the kind and the week in the data", () => {
    const message = buildRankPush({ direction: "up", cityName: "Cairo", weekStart: "2026-10-10" });

    expect(Object.keys(message.data).sort()).toEqual(["type", "weekStart"]);
  });

  it("never lets a health value into the title, the body or the data, whatever it is handed", () => {
    const input = { direction: "up", cityName: "Cairo", weekStart: "2026-10-10", ...HEALTH } as unknown as Parameters<typeof buildRankPush>[0];

    const text = allText(buildRankPush(input));

    for (const value of everythingTheBuilderMustNotEcho) expect(text).not.toContain(value);
  });
});
