import type { ActivityLevel, BodyGoal } from '@forjd/domain';

/**
 * The approved wording for activity levels and body goals (docs/product/scan-height-age-plan.md
 * §4.5). The slugs live in @forjd/domain; the words live here, like the training-goal chips.
 */
export const ACTIVITY_LEVEL_OPTIONS: ReadonlyArray<{ value: ActivityLevel; label: string; detail: string }> = [
  { value: 'mostly_sitting', label: 'Mostly sitting', detail: 'Desk job, little or no training' },
  { value: 'lightly_active', label: 'Lightly active', detail: 'On your feet some of the day, or training 1–2× a week' },
  { value: 'active', label: 'Active', detail: 'Training 3–4× a week' },
  { value: 'very_active', label: 'Very active', detail: 'Training 5–6× a week, or a physical job' },
  { value: 'athlete', label: 'Athlete', detail: 'Hard training most days, or twice a day' },
];

export const BODY_GOAL_OPTIONS: ReadonlyArray<{ value: BodyGoal; label: string; detail: string }> = [
  { value: 'lose_fat', label: 'Lose fat', detail: 'About 15% under maintenance, roughly 0.5–1% of body weight a week' },
  {
    value: 'recomposition',
    label: 'Body recomposition',
    detail: 'Lose fat and build muscle together: about 5% under maintenance, with more protein',
  },
  { value: 'maintain', label: 'Maintain', detail: 'Eat at maintenance to hold your weight steady' },
  { value: 'build_muscle', label: 'Build muscle', detail: 'About 10% over maintenance, a slow lean gain' },
];

export const activityLevelLabel = (value: ActivityLevel): string =>
  ACTIVITY_LEVEL_OPTIONS.find((option) => option.value === value)?.label ?? value;

export const bodyGoalLabel = (value: BodyGoal): string =>
  BODY_GOAL_OPTIONS.find((option) => option.value === value)?.label ?? value;

/** "Lose fat · 15% under maintenance", the Profile row's subtitle. */
export function bodyGoalSummary(value: BodyGoal): string {
  const detail: Record<BodyGoal, string> = {
    lose_fat: '15% under maintenance',
    recomposition: '5% under maintenance',
    maintain: 'at maintenance',
    build_muscle: '10% over maintenance',
  };
  return `${bodyGoalLabel(value)} · ${detail[value]}`;
}

/** 2750 → "2,750", without relying on Intl being present on the device. */
export function withThousands(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
