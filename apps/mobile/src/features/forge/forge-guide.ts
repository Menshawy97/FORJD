import type { ForgeLadder } from '@forjd/domain';

/**
 * What each ladder counts, in the words approved for How it works (mock-up C, 2026-09-27). The same
 * facts as the FAQ's "What counts toward each ladder?" (docs/product/faq-copy.md) and ADR-057
 * decision 9.
 */
export const FORGE_LADDER_COUNTS: Record<ForgeLadder, string> = {
  consistency: 'Completed workouts',
  volume: 'Weight × reps, warm-ups included',
  distance: 'Kilometres from running workouts',
  minutes: 'Workout time, up to 2 hours a workout',
  nourish: 'Days with at least one meal logged',
};
