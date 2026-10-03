import type { RunState, RunStats } from '@/workouts/live-run';

import { formatDistanceKm, formatDuration, formatPace } from './run-format';

/** The action set the notice offers: Pause and Finish while running, Resume and Finish while paused. */
export type RunNotificationCategory = 'run-running' | 'run-paused';

export interface RunNotificationContent {
  /** Android's header text, after the app name: "FORJD · Run". */
  header: string;
  title: string;
  body: string;
  category: RunNotificationCategory;
}

/**
 * The live run notice's text (12A-3), exactly as the approved replica v2 (2026-10-03) shows it, in the
 * run screen's own number formats. Built on the phone and shown on the phone only, so it may carry the
 * run's time, distance and pace (ADR-061 decision 3); it takes only those three, so no heart rate or
 * calorie value can reach it.
 */
export function runNotificationContent(
  stats: Pick<RunStats, 'movingSeconds' | 'distanceMeters' | 'averagePaceSecondsPerKm'>,
  status: RunState['status'],
): RunNotificationContent {
  const paused = status === 'paused';
  return {
    header: paused ? 'Run paused' : 'Run',
    title: `${formatDuration(stats.movingSeconds)} · ${formatDistanceKm(stats.distanceMeters)} km`,
    body: `Avg pace ${formatPace(stats.averagePaceSecondsPerKm)} /km`,
    category: paused ? 'run-paused' : 'run-running',
  };
}
