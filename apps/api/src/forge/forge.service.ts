import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ForgePendingWeeksResponse, ForgeResponse, PublicForge } from '@forjd/contracts';
import {
  bandOf,
  celebrationFor,
  FORGE_LADDER_IS_PUBLIC,
  FORGE_LADDER_UNITS,
  FORGE_LADDERS,
  ForgeBand,
  ForgeLadder,
  forgeWeekStart,
  maxLevelOf,
  previousWeekStart,
  summariseWeek,
  targetOf,
  weekClosesAt,
  weekDaysLeft,
} from '@forjd/domain';

import { FeatureFlagsRepository, WEEKLY_FORGE_FLAG } from '../feature-flags/feature-flags.repository';
import { ForgeEvaluationService } from './forge-evaluation.service';
import { ForgeReadRepository } from './forge-read.repository';
import { ForgeTotalsRepository } from './forge-totals.repository';

/**
 * Weekly Forge's routes (ADR-057). Every one answers 404 while `weekly_forge` is off, so the
 * feature is invisible until it is switched on. Reads evaluate the caller's closed weeks first
 * (evaluate-on-read, decision 4), so a delayed hourly job never makes an answer stale.
 */
@Injectable()
export class ForgeService {
  constructor(
    @Inject(FeatureFlagsRepository) private readonly flags: Pick<FeatureFlagsRepository, 'isEnabled'>,
    @Inject(ForgeEvaluationService)
    private readonly evaluation: Pick<ForgeEvaluationService, 'ensureEnrolled' | 'evaluateDue' | 'timeZoneFor'>,
    @Inject(ForgeTotalsRepository) private readonly totals: Pick<ForgeTotalsRepository, 'weeklyTotals'>,
    @Inject(ForgeReadRepository)
    private readonly read: Pick<
      ForgeReadRepository,
      'ladders' | 'badges' | 'pendingWeeks' | 'hasWeek' | 'acknowledge' | 'setTimeZone'
    >,
  ) {}

  /** The current week on every ladder. Enrols the caller at Ore 1 the first time. */
  async getForge(userId: string, now: Date): Promise<ForgeResponse> {
    await this.assertEnabled();
    await this.evaluation.ensureEnrolled(userId, now);
    await this.evaluation.evaluateDue(userId, now);

    const timeZone = await this.evaluation.timeZoneFor(userId);
    const weekStart = forgeWeekStart(now, timeZone);
    const window = {
      weekStart,
      start: weekClosesAt(previousWeekStart(weekStart), timeZone),
      end: weekClosesAt(weekStart, timeZone),
    };
    const [ladders, badges, totals] = await Promise.all([
      this.read.ladders(userId),
      this.read.badges(userId),
      this.totals.weeklyTotals(userId, window, now),
    ]);

    return {
      weekStart,
      daysLeft: weekDaysLeft(now, timeZone),
      timeZone,
      ladders: FORGE_LADDERS.flatMap((ladder) => {
        const row = ladders.find((candidate) => candidate.ladder === ladder);
        if (!row) return [];
        const level = Math.min(row.level, maxLevelOf(ladder));
        const target = targetOf(ladder, level);
        return [
          {
            ladder,
            unit: FORGE_LADDER_UNITS[ladder],
            band: bandOf(ladder, level),
            level,
            maxLevel: maxLevelOf(ladder),
            target,
            total: totals[ladder],
            progress: Math.min(1, totals[ladder] / target),
            missStreak: row.missStreak,
            temperedHoldWeeks: row.temperedHoldWeeks,
            forgedStreak: row.forgedStreak,
            bestForgedStreak: row.bestForgedStreak,
            badges: badgesFor(badges, ladder),
          },
        ];
      }),
    };
  }

  /** Closed weeks the caller has not seen, oldest first, each with its one celebration. */
  async pendingWeeks(userId: string, now: Date): Promise<ForgePendingWeeksResponse> {
    await this.assertEnabled();
    await this.evaluation.evaluateDue(userId, now);
    const weeks = await this.read.pendingWeeks(userId);
    return {
      weeks: weeks.map((week) => {
        const summary = summariseWeek(week.ladders);
        return {
          weekStart: week.weekStart,
          biggest: summary.biggest,
          biggestLadder: summary.biggestLadder,
          shareable: summary.shareable,
          levelsGained: summary.levelsGained,
          marksEarned: summary.marksEarned,
          ladders: week.ladders.map((ladder) => ({ ...ladder, celebration: celebrationFor(ladder) })),
        };
      }),
    };
  }

  /** Marks one closed week as seen. A week the caller never had is a 404, not a silent success. */
  async acknowledge(userId: string, weekStart: string): Promise<void> {
    await this.assertEnabled();
    if (!(await this.read.hasWeek(userId, weekStart))) {
      throw new NotFoundException('Week not found');
    }
    await this.read.acknowledge(userId, weekStart);
  }

  async setTimeZone(userId: string, timeZone: string): Promise<void> {
    await this.read.setTimeZone(userId, timeZone);
  }

  /**
   * The Forge block for the public athlete profile: public ladders only, never Nourish. `null`
   * while the flag is off or before the athlete is enrolled. Reads never enrol a stranger.
   */
  async publicForgeFor(userId: string): Promise<PublicForge | null> {
    if (!(await this.flags.isEnabled(WEEKLY_FORGE_FLAG))) {
      return null;
    }
    const [ladders, badges] = await Promise.all([this.read.ladders(userId), this.read.badges(userId)]);
    if (ladders.length === 0) {
      return null;
    }
    return {
      ladders: FORGE_LADDERS.filter((ladder) => FORGE_LADDER_IS_PUBLIC[ladder]).flatMap((ladder) => {
        const row = ladders.find((candidate) => candidate.ladder === ladder);
        if (!row) return [];
        const level = Math.min(row.level, maxLevelOf(ladder));
        return [
          {
            ladder: ladder as Exclude<ForgeLadder, 'nourish'>,
            band: bandOf(ladder, level),
            level,
            forgedStreak: row.forgedStreak,
            bestForgedStreak: row.bestForgedStreak,
            badges: badgesFor(badges, ladder),
          },
        ];
      }),
    };
  }

  private async assertEnabled(): Promise<void> {
    if (!(await this.flags.isEnabled(WEEKLY_FORGE_FLAG))) {
      throw new NotFoundException('Not found');
    }
  }
}

function badgesFor(badges: Array<{ ladder: ForgeLadder; band: ForgeBand }>, ladder: ForgeLadder): ForgeBand[] {
  return badges.filter((badge) => badge.ladder === ladder).map((badge) => badge.band);
}
