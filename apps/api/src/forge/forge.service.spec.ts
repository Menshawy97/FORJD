import { NotFoundException } from "@nestjs/common";

import { ForgeClosedWeek, ForgeLadderRow } from "./forge-read.repository";
import { ForgeService } from "./forge.service";

const USER = "user-1";
// Wednesday 30 September 2026, 12:00 UTC: 15:00 in Cairo, in the week of Saturday 26 September.
const NOW = new Date("2026-09-30T12:00:00Z");

const row = (ladder: ForgeLadderRow["ladder"], level = 1): ForgeLadderRow => ({
  ladder,
  level,
  missStreak: 0,
  temperedHoldWeeks: 0,
  forgedStreak: 0,
  bestForgedStreak: 0,
});

function build(over: { enabled?: boolean; ladders?: ForgeLadderRow[]; pending?: ForgeClosedWeek[]; hasWeek?: boolean } = {}) {
  const flags = { isEnabled: jest.fn(async () => over.enabled ?? true) };
  const evaluation = {
    ensureEnrolled: jest.fn(async () => undefined),
    evaluateDue: jest.fn(async () => 0),
    timeZoneFor: jest.fn(async () => "Africa/Cairo"),
  };
  const totals = {
    weeklyTotals: jest.fn(async () => ({ consistency: 1, volume: 3000, distance: 0, minutes: 45, nourish: 2 })),
  };
  const read = {
    ladders: jest.fn(async () =>
      over.ladders ?? [row("consistency"), row("volume", 7), row("distance"), row("minutes"), row("nourish")],
    ),
    badges: jest.fn(async () => [{ ladder: "volume" as const, band: "ember" as const }]),
    pendingWeeks: jest.fn(async () => over.pending ?? []),
    hasWeek: jest.fn(async () => over.hasWeek ?? true),
    acknowledge: jest.fn(async () => undefined),
    setTimeZone: jest.fn(async () => undefined),
  };
  const service = new ForgeService(flags, evaluation, totals, read);
  return { service, flags, evaluation, totals, read };
}

describe("ForgeService", () => {
  describe("while weekly_forge is off", () => {
    it("answers 404 on every route, so the feature stays dark", async () => {
      const { service, evaluation } = build({ enabled: false });

      await expect(service.getForge(USER, NOW)).rejects.toThrow(NotFoundException);
      await expect(service.pendingWeeks(USER, NOW)).rejects.toThrow(NotFoundException);
      await expect(service.acknowledge(USER, "2026-09-19")).rejects.toThrow(NotFoundException);
      expect(evaluation.ensureEnrolled).not.toHaveBeenCalled();
    });

    it("leaves the public profile without a Forge block", async () => {
      const { service, read } = build({ enabled: false });

      expect(await service.publicForgeFor(USER)).toBeNull();
      expect(read.ladders).not.toHaveBeenCalled();
    });
  });

  describe("getForge", () => {
    it("enrols the caller and evaluates closed weeks before reading", async () => {
      const { service, evaluation } = build();

      await service.getForge(USER, NOW);

      expect(evaluation.ensureEnrolled).toHaveBeenCalledWith(USER, NOW);
      expect(evaluation.evaluateDue).toHaveBeenCalledWith(USER, NOW);
    });

    it("reports this week live, in the caller's zone, with every ladder in screen order", async () => {
      const { service, totals } = build();

      const forge = await service.getForge(USER, NOW);

      expect(forge).toMatchObject({ weekStart: "2026-09-26", daysLeft: 3, timeZone: "Africa/Cairo" });
      expect(forge.ladders.map((ladder) => ladder.ladder)).toEqual(["consistency", "volume", "distance", "minutes", "nourish"]);
      expect(totals.weeklyTotals).toHaveBeenCalledWith(
        USER,
        { weekStart: "2026-09-26", start: new Date("2026-09-25T21:00:00Z"), end: new Date("2026-10-02T21:00:00Z") },
        NOW,
      );
    });

    it("gives each ladder its band, target, progress capped at 1, and badges", async () => {
      const { service } = build();

      const ladders = (await service.getForge(USER, NOW)).ladders;
      const volume = ladders.find((ladder) => ladder.ladder === "volume");

      expect(volume).toEqual({
        ladder: "volume",
        unit: "kg",
        band: "anvil",
        level: 7,
        maxLevel: 15,
        target: 13000,
        total: 3000,
        progress: 3000 / 13000,
        missStreak: 0,
        temperedHoldWeeks: 0,
        forgedStreak: 0,
        bestForgedStreak: 0,
        badges: ["ember"],
      });
      expect(ladders.find((ladder) => ladder.ladder === "nourish")?.progress).toBe(1);
    });
  });

  describe("pendingWeeks", () => {
    it("summarises each unseen closed week with its one celebration", async () => {
      const week: ForgeClosedWeek = {
        weekStart: "2026-09-19",
        ladders: [
          {
            ladder: "volume",
            outcome: "hit",
            levelBefore: 6,
            levelAfter: 7,
            bandBefore: "ore",
            bandAfter: "ember",
            total: 5100,
            target: 5000,
            rewards: [
              { type: "forge_mark", level: 7, band: "ember" },
              { type: "band_badge", level: 7, band: "ember" },
            ],
          },
        ],
      };
      const { service, evaluation } = build({ pending: [week] });

      const { weeks } = await service.pendingWeeks(USER, NOW);

      expect(evaluation.evaluateDue).toHaveBeenCalledWith(USER, NOW);
      expect(weeks[0]).toMatchObject({
        weekStart: "2026-09-19",
        biggest: "band",
        biggestLadder: "volume",
        shareable: true,
        levelsGained: 1,
        marksEarned: 1,
      });
      expect(weeks[0]?.ladders[0]?.celebration).toBe("band");
    });
  });

  describe("acknowledge", () => {
    it("records a week the caller has", async () => {
      const { service, read } = build();

      await service.acknowledge(USER, "2026-09-19");

      expect(read.acknowledge).toHaveBeenCalledWith(USER, "2026-09-19");
    });

    it("answers 404 for a week the caller never had", async () => {
      const { service, read } = build({ hasWeek: false });

      await expect(service.acknowledge(USER, "2026-09-19")).rejects.toThrow(NotFoundException);
      expect(read.acknowledge).not.toHaveBeenCalled();
    });
  });

  it("stores the phone's time zone", async () => {
    const { service, read } = build();

    await service.setTimeZone(USER, "Asia/Dubai");

    expect(read.setTimeZone).toHaveBeenCalledWith(USER, "Asia/Dubai");
  });

  describe("publicForgeFor", () => {
    it("shows the public ladders only, never Nourish", async () => {
      const { service } = build();

      const block = await service.publicForgeFor(USER);

      expect(block?.ladders.map((ladder) => ladder.ladder)).toEqual(["consistency", "volume", "distance", "minutes"]);
      expect(block?.ladders.find((ladder) => ladder.ladder === "volume")).toEqual({
        ladder: "volume",
        band: "anvil",
        level: 7,
        forgedStreak: 0,
        bestForgedStreak: 0,
        badges: ["ember"],
      });
    });

    it("is null for an athlete who was never enrolled, and never enrols them", async () => {
      const { service, evaluation } = build({ ladders: [] });

      expect(await service.publicForgeFor(USER)).toBeNull();
      expect(evaluation.ensureEnrolled).not.toHaveBeenCalled();
    });
  });
});
