import { Injectable } from "@nestjs/common";
import type { ProgressStrengthQuery, ProgressStrengthResponse } from "@forjd/contracts";
import { evaluateInsight, User } from "@forjd/domain";

import { ProgressRepository } from "./progress.repository";

/**
 * A thin pass-through, matching `WorkoutSessionsService.stats`'s own reasoning: the arithmetic
 * belongs in SQL and in `@forjd/domain`, next to the data and the rules it derives from, and
 * this service's only jobs are scoping the read to the caller's own id, turning `Date`s into
 * the ISO strings the response schema declares, and calling `evaluateInsight` with what the
 * repository computed.
 *
 * `now` is read here, not inside the repository, so `ProgressRepository` stays a pure function
 * of its arguments and its calendar boundaries remain testable -- the same split
 * `WorkoutSessionsService.stats` already uses.
 */
@Injectable()
export class ProgressService {
  constructor(private readonly progressRepository: ProgressRepository) {}

  async strength(viewer: User, query: ProgressStrengthQuery): Promise<ProgressStrengthResponse> {
    const row = await this.progressRepository.progressStrengthForUser(
      viewer.id,
      query.timeZone,
      new Date(),
    );

    return {
      personalRecords: row.personalRecords.map((record) => ({
        ...record,
        achievedAt: record.achievedAt.toISOString(),
      })),
      oneRepMaxTrend: row.oneRepMaxTrend,
      weeklyVolumeKg: row.weeklyVolumeKg,
      trainingCalendar: row.trainingCalendar,
      muscleSplit: row.muscleSplit,
      insight: evaluateInsight({
        volumeKgThisWeek: row.volumeKgThisWeek,
        volumeKgLastWeek: row.volumeKgLastWeek,
        sessionsThisWeek: row.sessionsThisWeek,
        weeksOfHistory: row.weeksOfHistory,
        readyToProgress:
          row.readyToProgress === null ? null : { exerciseName: row.readyToProgress.exerciseName },
        estimatedOneRepMaxTrendKg: row.oneRepMaxTrend.map((point) => point.estimatedOneRepMaxKg),
      }),
    };
  }
}
