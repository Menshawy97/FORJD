import { Inject, Injectable } from '@nestjs/common';
import {
  clampForgeState,
  evaluateWeek,
  FORGE_DEFAULT_TIME_ZONE,
  FORGE_RULES_VERSION,
  forgeWeekStart,
  isValidTimeZone,
  nextWeekStart,
  previousWeekStart,
  weekClosesAt,
} from '@forjd/domain';

import { ForgeLastWeek, ForgeStateRepository, ForgeStateRow, ForgeStateStore, ForgeWeekWrite } from './forge-state.repository';
import { ForgeTotalsRepository, ForgeWeeklyTotals, ForgeWeekWindow } from './forge-totals.repository';

/** The slice of the totals repository the service uses, so its spec can pass a fake. */
export interface ForgeTotalsSource {
  weeklyTotals(userId: string, week: ForgeWeekWindow, lockAt: Date): Promise<ForgeWeeklyTotals>;
}

/**
 * A guard, not a rule: an athlete whose weeks have not been evaluated for this long is caught up a
 * year at a time, so one request can never loop for ever.
 */
const MAX_WEEKS_PER_CALL = 52;

/**
 * Enrols athletes and evaluates their closed Forge weeks (ADR-057 decisions 4, 5 and 10). Both the
 * hourly job and evaluate-on-read call `evaluateDue`, and it is idempotent: it only ever evaluates
 * the week after each ladder's `last_evaluated_week`, under the row lock `lockAndApply` takes.
 */
@Injectable()
export class ForgeEvaluationService {
  constructor(
    @Inject(ForgeStateRepository) private readonly store: ForgeStateStore,
    @Inject(ForgeTotalsRepository) private readonly totals: ForgeTotalsSource,
  ) {}

  /** Enrols the athlete at Ore 1 in the current week of their zone. Idempotent. */
  async ensureEnrolled(userId: string, now: Date): Promise<void> {
    const timeZone = await this.timeZoneFor(userId);
    await this.store.enroll(userId, forgeWeekStart(now, timeZone));
  }

  /** Evaluates every closed, unevaluated week, oldest first. Returns how many weeks were written. */
  async evaluateDue(userId: string, now: Date): Promise<number> {
    const timeZone = await this.timeZoneFor(userId);
    let written = 0;
    while (written < MAX_WEEKS_PER_CALL) {
      const write = await this.store.lockAndApply(userId, (rows, lastWeek) => this.planNextWeek(userId, rows, lastWeek, timeZone, now));
      if (write === null) {
        break;
      }
      written += 1;
    }
    return written;
  }

  /**
   * The next week to evaluate is the earliest week any ladder is waiting on; only the ladders
   * waiting on that week are evaluated in it (a ladder added later catches up on its own schedule).
   */
  private async planNextWeek(
    userId: string,
    rows: ForgeStateRow[],
    lastWeek: ForgeLastWeek | null,
    timeZone: string,
    now: Date,
  ): Promise<ForgeWeekWrite | null> {
    const pending = rows.map((row) => ({
      row,
      week: row.lastEvaluatedWeek === null ? row.enrolledWeek : nextWeekStart(row.lastEvaluatedWeek),
    }));
    if (pending.length === 0) {
      return null;
    }

    const weekStart = pending.map((item) => item.week).sort()[0]!;
    const closesAt = weekClosesAt(weekStart, timeZone);
    if (closesAt.getTime() > now.getTime()) {
      return null;
    }

    // Chain from the stored close of the week before, not a recomputation in today's zone: after a
    // time-zone change the two would differ, and a workout could fall between the weeks or in both.
    const previous = previousWeekStart(weekStart);
    const start = lastWeek?.weekStart === previous ? lastWeek.closesAt : weekClosesAt(previous, timeZone);
    const window = { weekStart, start, end: closesAt };
    const totals = await this.totals.weeklyTotals(userId, window, closesAt);
    const results = pending
      .filter((item) => item.week === weekStart)
      .map(({ row }) => ({
        ladder: row.ladder,
        result: evaluateWeek(row.ladder, clampForgeState(row.ladder, row.state), totals[row.ladder]),
      }));

    return { weekStart, timeZone, closesAt, rulesVersion: FORGE_RULES_VERSION, totals, results };
  }

  private async timeZoneFor(userId: string): Promise<string> {
    const stored = await this.store.timeZoneOf(userId);
    return stored !== null && isValidTimeZone(stored) ? stored : FORGE_DEFAULT_TIME_ZONE;
  }
}
