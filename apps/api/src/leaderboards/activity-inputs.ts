import { scoreCohort, type AthleteActivityInput, type RankedAthlete } from '@forjd/domain';

import { allTimeWeeks, monthWeeks } from './city-time';
import type { CityAthleteRow } from './leaderboards.repository';

/**
 * The raw per-athlete totals as the scoring function takes them. The window's length in weeks is
 * what the WHO targets are scaled by: the calendar month for "this month", and for "all time" each
 * athlete's own time since their first eligible session.
 *
 * Shared by the leaderboard read and the weekly snapshot job, so the rank a snapshot records is by
 * construction the rank the board would have shown at that moment (ADR-047).
 */
export function buildActivityInputs(
  athletes: readonly CityAthleteRow[],
  window: { start: Date; end: Date } | null,
  now: Date,
): AthleteActivityInput[] {
  return athletes.map((athlete) => ({
    userId: athlete.userId,
    workingMinutes: athlete.workingSeconds / 60,
    strengthDays: athlete.strengthDays,
    volumeKg: athlete.volumeKg,
    distanceKm: athlete.distanceKm,
    weeks: window ? monthWeeks(window, now) : allTimeWeeks(athlete.firstStartedAt, now),
    firstStartedAtMs: athlete.firstStartedAt.getTime(),
  }));
}

/** A whole city's board, best first. */
export function rankCity(
  athletes: readonly CityAthleteRow[],
  window: { start: Date; end: Date } | null,
  now: Date,
): RankedAthlete[] {
  return scoreCohort(buildActivityInputs(athletes, window, now));
}
