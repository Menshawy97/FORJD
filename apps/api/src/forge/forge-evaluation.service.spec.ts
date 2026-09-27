import { FORGE_LADDERS, FORGE_RULES_VERSION, ForgeLadder, initialForgeState } from "@forjd/domain";

import { ForgeEvaluationService } from "./forge-evaluation.service";
import { ForgeLastWeek, ForgeStateRow, ForgeStateStore, ForgeWeekWrite } from "./forge-state.repository";
import { ForgeWeeklyTotals, ForgeWeekWindow } from "./forge-totals.repository";

const ZERO: ForgeWeeklyTotals = { consistency: 0, volume: 0, distance: 0, minutes: 0, nourish: 0 };

/** An in-memory stand-in for the state repository that applies writes the way the real one does. */
class FakeStore implements ForgeStateStore {
  rows = new Map<string, ForgeStateRow[]>();
  writes: ForgeWeekWrite[] = [];
  enrolled: Array<{ userId: string; weekStart: string }> = [];
  timeZones = new Map<string, string | null>();
  lastClose = new Map<string, ForgeLastWeek>();

  async timeZoneOf(userId: string): Promise<string | null> {
    return this.timeZones.get(userId) ?? null;
  }

  async enroll(userId: string, weekStart: string): Promise<void> {
    this.enrolled.push({ userId, weekStart });
    if (!this.rows.has(userId)) {
      this.rows.set(
        userId,
        FORGE_LADDERS.map((ladder) => ({
          ladder,
          state: initialForgeState(),
          enrolledWeek: weekStart,
          lastEvaluatedWeek: null,
        })),
      );
    }
  }

  async lockAndApply(
    userId: string,
    plan: (rows: ForgeStateRow[], lastWeek: ForgeLastWeek | null) => Promise<ForgeWeekWrite | null>,
  ): Promise<ForgeWeekWrite | null> {
    const write = await plan(this.rows.get(userId) ?? [], this.lastClose.get(userId) ?? null);
    if (write === null) return null;
    this.writes.push(write);
    this.lastClose.set(userId, { weekStart: write.weekStart, closesAt: write.closesAt });
    this.rows.set(
      userId,
      (this.rows.get(userId) ?? []).map((row) => {
        const evaluated = write.results.find((r) => r.ladder === row.ladder);
        return evaluated ? { ...row, state: evaluated.result.next, lastEvaluatedWeek: write.weekStart } : row;
      }),
    );
    return write;
  }
}

class FakeTotals {
  calls: Array<{ userId: string; week: ForgeWeekWindow; lockAt: Date }> = [];
  constructor(private readonly byWeek: Record<string, Partial<ForgeWeeklyTotals>> = {}) {}

  async weeklyTotals(userId: string, week: ForgeWeekWindow, lockAt: Date): Promise<ForgeWeeklyTotals> {
    this.calls.push({ userId, week, lockAt });
    return { ...ZERO, ...this.byWeek[week.weekStart] };
  }
}

/** Records each stale-check, and how many weeks had been written when it ran. */
class FakeRefold {
  calls: Array<{ userId: string; writesBefore: number }> = [];
  constructor(private readonly store: FakeStore) {}

  async refoldUserIfStale(userId: string): Promise<boolean> {
    this.calls.push({ userId, writesBefore: this.store.writes.length });
    return false;
  }
}

const USER = "user-1";

function build(totals = new FakeTotals()) {
  const store = new FakeStore();
  const refold = new FakeRefold(store);
  const service = new ForgeEvaluationService(store, totals, refold);
  return { store, totals, refold, service };
}

const levelOf = (store: FakeStore, ladder: ForgeLadder) =>
  store.rows.get(USER)!.find((row) => row.ladder === ladder)!.state.level;

describe("ForgeEvaluationService", () => {
  describe("ensureEnrolled", () => {
    it("enrols the athlete at Ore 1 in the Saturday week of now, in their own zone", async () => {
      const { store, service } = build();
      store.timeZones.set(USER, "Africa/Cairo");

      // Friday 25 September 21:30 UTC is already Saturday 26 September in Cairo.
      await service.ensureEnrolled(USER, new Date("2026-09-25T21:30:00Z"));

      expect(store.enrolled).toEqual([{ userId: USER, weekStart: "2026-09-26" }]);
    });

    it("uses Cairo when the athlete has no time zone yet, or an invalid one", async () => {
      const { store, service } = build();
      store.timeZones.set(USER, "Not/AZone");

      await service.ensureEnrolled(USER, new Date("2026-09-25T21:30:00Z"));

      expect(store.enrolled[0]?.weekStart).toBe("2026-09-26");
    });
  });

  describe("evaluateDue", () => {
    it("does nothing for an athlete who is not enrolled", async () => {
      const { store, service } = build();

      expect(await service.evaluateDue(USER, new Date("2026-10-10T00:00:00Z"))).toBe(0);
      expect(store.writes).toEqual([]);
    });

    it("does nothing before the enrolment week has closed", async () => {
      const { store, service } = build();
      await store.enroll(USER, "2026-09-26");

      // Friday 2 October 20:59 UTC is Friday 23:59 in Cairo: the week is still open.
      expect(await service.evaluateDue(USER, new Date("2026-10-02T20:59:00Z"))).toBe(0);
    });

    it("evaluates the enrolment week once it closes, locking the totals at the close", async () => {
      const totals = new FakeTotals({ "2026-09-26": { volume: 2000, consistency: 1 } });
      const { store, service } = build(totals);
      await store.enroll(USER, "2026-09-26");

      const evaluated = await service.evaluateDue(USER, new Date("2026-10-02T21:00:00Z"));

      expect(evaluated).toBe(1);
      expect(totals.calls[0]).toEqual({
        userId: USER,
        week: {
          weekStart: "2026-09-26",
          start: new Date("2026-09-25T21:00:00Z"),
          end: new Date("2026-10-02T21:00:00Z"),
        },
        lockAt: new Date("2026-10-02T21:00:00Z"),
      });
      expect(store.writes[0]).toMatchObject({
        weekStart: "2026-09-26",
        timeZone: "Africa/Cairo",
        closesAt: new Date("2026-10-02T21:00:00Z"),
        rulesVersion: FORGE_RULES_VERSION,
      });
      expect(levelOf(store, "volume")).toBe(2);
      expect(levelOf(store, "consistency")).toBe(2);
      expect(levelOf(store, "distance")).toBe(1);
    });

    it("records every ladder's locked total and result for the week", async () => {
      // Level 1 (2 000 kg); 4 000 clears level 3's goal too, so the week is an overshoot.
      const totals = new FakeTotals({ "2026-09-26": { volume: 4000 } });
      const { store, service } = build(totals);
      await store.enroll(USER, "2026-09-26");

      await service.evaluateDue(USER, new Date("2026-10-03T00:00:00Z"));

      const write = store.writes[0]!;
      expect(write.results.map((r) => r.ladder)).toEqual([...FORGE_LADDERS]);
      expect(write.totals.volume).toBe(4000);
      expect(write.results.find((r) => r.ladder === "volume")?.result.outcome).toBe("overshoot");
    });

    it("recomputes an athlete left on an older rules version before evaluating anything (ADR-058)", async () => {
      // The backstop for a deploy window: an old API revision may close a week under the old table
      // after that deploy's refold has already run.
      const totals = new FakeTotals({ "2026-09-26": { volume: 2000 } });
      const { store, refold, service } = build(totals);
      await store.enroll(USER, "2026-09-26");

      await service.evaluateDue(USER, new Date("2026-10-03T00:00:00Z"));

      expect(refold.calls).toEqual([{ userId: USER, writesBefore: 0 }]);
      expect(store.writes).toHaveLength(1);
    });

    it("catches up every closed week in order after a missed run", async () => {
      const totals = new FakeTotals({
        "2026-09-26": { volume: 2000 },
        "2026-10-03": { volume: 3000 },
        "2026-10-10": { volume: 4000 },
      });
      const { store, service } = build(totals);
      await store.enroll(USER, "2026-09-26");

      // Two weeks and a bit later: three weeks have closed.
      const evaluated = await service.evaluateDue(USER, new Date("2026-10-17T12:00:00Z"));

      expect(evaluated).toBe(3);
      expect(store.writes.map((w) => w.weekStart)).toEqual(["2026-09-26", "2026-10-03", "2026-10-10"]);
      expect(levelOf(store, "volume")).toBe(4);
    });

    it("is a no-op when run again for the same moment", async () => {
      const { store, service } = build();
      await store.enroll(USER, "2026-09-26");
      const now = new Date("2026-10-03T00:00:00Z");

      await service.evaluateDue(USER, now);
      const second = await service.evaluateDue(USER, now);

      expect(second).toBe(0);
      expect(store.writes).toHaveLength(1);
    });

    it("closes weeks in the athlete's own zone", async () => {
      const { store, service } = build();
      store.timeZones.set(USER, "America/New_York");
      await store.enroll(USER, "2026-09-26");

      // Saturday 3 October 00:00 in New York is 04:00 UTC.
      expect(await service.evaluateDue(USER, new Date("2026-10-03T03:59:00Z"))).toBe(0);
      expect(await service.evaluateDue(USER, new Date("2026-10-03T04:00:00Z"))).toBe(1);
    });

    it("starts the next week exactly where the last one closed, even after the athlete changes time zone", async () => {
      const totals = new FakeTotals();
      const { store, service } = build(totals);
      store.timeZones.set(USER, "Africa/Cairo");
      await store.enroll(USER, "2026-09-26");
      await service.evaluateDue(USER, new Date("2026-10-03T00:00:00Z"));

      // The athlete flies to Los Angeles; the next week closes on Pacific time, but it must start at
      // the Cairo close, so no workout falls between the two weeks or into both.
      store.timeZones.set(USER, "America/Los_Angeles");
      await service.evaluateDue(USER, new Date("2026-10-10T08:00:00Z"));

      expect(totals.calls[1]?.week).toEqual({
        weekStart: "2026-10-03",
        start: new Date("2026-10-02T21:00:00Z"),
        end: new Date("2026-10-10T07:00:00Z"),
      });
    });

    it("evaluates a ladder added later from its own enrolment week, alongside the others", async () => {
      const { store, service } = build();
      await store.enroll(USER, "2026-09-26");
      await service.evaluateDue(USER, new Date("2026-10-03T00:00:00Z"));
      // A ladder whose row was created a week later has not caught up.
      store.rows.set(
        USER,
        store.rows.get(USER)!.map((row) =>
          row.ladder === "nourish" ? { ...row, enrolledWeek: "2026-10-03", lastEvaluatedWeek: null } : row,
        ),
      );

      await service.evaluateDue(USER, new Date("2026-10-10T00:00:00Z"));

      expect(store.writes[1]?.results.map((r) => r.ladder)).toEqual([...FORGE_LADDERS]);
    });

    it("brings a state above a shrunken ladder's top down before evaluating it", async () => {
      const { store, service } = build();
      await store.enroll(USER, "2026-09-26");
      store.rows.set(
        USER,
        store.rows.get(USER)!.map((row) =>
          row.ladder === "nourish" ? { ...row, state: { ...row.state, level: 9, bestLevel: 9 } } : row,
        ),
      );

      await service.evaluateDue(USER, new Date("2026-10-03T00:00:00Z"));

      expect(levelOf(store, "nourish")).toBe(6);
    });
  });
});
