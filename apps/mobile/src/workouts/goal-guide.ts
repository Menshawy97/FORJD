import type { ExerciseGoal } from '@forjd/domain';

export interface GoalGuideRow {
  goal: ExerciseGoal;
  load: string;
  reps: string;
  rest: string;
  execution: string;
  advice: string;
}

/**
 * The "How to train this" guide, ported verbatim from the prototype's `guideTable()`. Static
 * reference content, not advice generated about this user -- which is why it can ship now,
 * unlike the Watch card's heart rate.
 *
 * Shared by `training-guide-card.tsx` (the collapsible card) and `app/live.tsx`'s own
 * training-goal picker sheet, which is why it lives in its own module rather than inside
 * either.
 */
export const GOAL_GUIDE: GoalGuideRow[] = [
  {
    goal: 'strength',
    load: '80–95% 1RM',
    reps: '1–5 reps',
    rest: '3–5 min rest',
    execution: 'Controlled down, aggressive press',
    advice: 'Move heavy weight with excellent technique',
  },
  {
    goal: 'hypertrophy',
    load: '60–80% 1RM',
    reps: '6–15 reps',
    rest: '1.5–3 min rest',
    execution: 'Controlled eccentric, full range of motion',
    advice: 'Maximise muscle tension and train close to failure',
  },
  {
    goal: 'power',
    load: '30–70% 1RM',
    reps: '2–5 reps',
    rest: '2–4 min rest',
    execution: 'Explosive concentric, reset every rep',
    advice: 'Move the bar as fast as possible',
  },
  {
    goal: 'muscular_endurance',
    load: '40–60% 1RM',
    reps: '12–25+ reps',
    rest: '30–90 s rest',
    execution: 'Controlled, steady tempo',
    advice: 'Hold form while fatigue accumulates',
  },
  {
    goal: 'mobility',
    load: 'Bodyweight',
    reps: '5–10 per side',
    rest: 'Minimal rest',
    execution: 'Slow, breathe through the position',
    advice: 'Own the end range instead of bouncing into it',
  },
];
