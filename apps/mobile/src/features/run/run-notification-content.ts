import type { RunState, RunStats } from '@/workouts/live-run';

import { formatDuration, formatRunDistance, formatRunPace, RUN_UNIT_LABELS, type RunUnit } from './run-format';

/** The action set the notice offers: Pause and Finish while running, Resume and Finish while paused. */
export type RunNotificationCategory = 'run-running' | 'run-paused';

export interface RunNotificationContent {
  /** Android's subText (`subtitle`): shown beside the app name or the title; the exact place varies by phone. */
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
  /** The Units distance choice (docs/product/run-miles-plan.md); kilometres by default. */
  unit: RunUnit = 'km',
): RunNotificationContent {
  const paused = status === 'paused';
  const labels = RUN_UNIT_LABELS[unit];
  return {
    header: paused ? 'Run paused' : 'Run',
    title: `${formatDuration(stats.movingSeconds)} · ${formatRunDistance(stats.distanceMeters, unit)} ${labels.distance}`,
    body: `Avg pace ${formatRunPace(stats.averagePaceSecondsPerKm, unit)} ${labels.pace}`,
    category: paused ? 'run-paused' : 'run-running',
  };
}
