import type { WorkoutSessionResponse } from '@forjd/contracts';
import type { ExerciseGoal } from '@forjd/domain';

import type { LiveExercise } from './live-session';

/**
 * Everything Train's "Previous Workout" card shows, derived from one `WorkoutSessionResponse`
 * (Phase 3J-b, `screenshots/train2.png`).
 *
 * Pure -- no React, no SQLite, no network -- for the same reason `live-session.ts` is: the
 * interesting parts here are arithmetic and formatting decisions, and each one is a place a
 * plausible-looking bug would show the athlete a number about their own training that is
 * quietly wrong. They are far easier to pin down as functions than as a rendered tree.
 *
 * Exercise *names* are not in the response -- a session carries `exerciseId` only -- so the
 * chip builder takes a resolver, which the screen backs with the on-device catalogue (ADR-022)
 * so the card still works offline.
 */

type SessionExercise = WorkoutSessionResponse['exercises'][number];
type SessionSet = SessionExercise['sets'][number];

/**
 * `0:00`, `45:12`, `1:02:11` -- the prototype's own `fmt`, and the shape both the card's meta
 * line and `workout-done.tsx`'s Duration tile use. It lived privately in that screen until
 * this slice needed a second copy.
 */
export function formatSessionDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight local, so the difference below counts calendar days rather than elapsed hours. */
function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * `Today`, `Yesterday`, `2 days ago`, `Last week`, `3 weeks ago` -- the vocabulary the
 * prototype's own rows use (`2 days ago`, `Last week`, `5 days ago`).
 *
 * **Calendar days, not elapsed hours.** A session finished at 23:00 last night is "Yesterday"
 * when the athlete opens the app at 07:00, even though only eight hours have passed; an
 * hours-based calculation would call it "Today" and read as a workout that has not happened.
 *
 * A timestamp in the future -- clock skew, or a session started seconds ago against a device
 * clock that is behind -- is clamped to "Today" rather than allowed to render "-1 days ago".
 */
export function formatRelativeDay(startedAt: Date, now: Date): string {
  const days = Math.round(
    (startOfLocalDay(now) - startOfLocalDay(startedAt)) / MILLISECONDS_PER_DAY,
  );
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? 'Last week' : `${weeks} weeks ago`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * A history row's date -- `Yesterday` for something recent, `16 Aug` for anything older
 * (Phase 3J-d).
 *
 * Exactly the mix the prototype's own History list uses: its four rows read `Yesterday`,
 * `16 Aug`, `12 Aug`, `9 Aug`. "Three weeks ago" is precise but useless for locating a session
 * in a list, while a bare date for yesterday is colder than it needs to be -- so the relative
 * form is kept for the stretch where it genuinely reads better and dropped after that.
 *
 * Built from a fixed month table rather than `Intl`, for the reason `features/home/date.ts`
 * already documents: Hermes ships a trimmed ICU on Android, so locale output is not guaranteed
 * to match what Node prints in a test.
 */
export function formatHistoryDate(performedAt: Date, now: Date): string {
  const relative = formatRelativeDay(performedAt, now);
  if (relative === 'Today' || relative === 'Yesterday' || relative.endsWith('days ago')) {
    return relative;
  }
  return `${performedAt.getDate()} ${MONTHS[performedAt.getMonth()]}`;
}

/**
 * Total external load moved, in kilograms -- the meta line's `14,200 kg`.
 *
 * Counts **completed sets only**. A set the athlete never ticked was never performed, and
 * including it would inflate a figure the card presents as what they actually lifted. Sets
 * with no weight or no reps (bodyweight, timed, distance work) contribute nothing: they are
 * not zero-weight lifts, they are a different measure, and there is no honest way to fold
 * them into a kilogram total.
 */
export function sessionVolumeKg(session: WorkoutSessionResponse): number {
  let total = 0;
  for (const exercise of session.exercises) {
    for (const set of exercise.sets) {
      if (!set.isCompleted) continue;
      if (set.weightKg === null || set.reps === null) continue;
      total += set.weightKg * set.reps;
    }
  }
  return total;
}

/** The heaviest completed set, which is the one the prototype's chip names. */
function bestCompletedSet(exercise: SessionExercise): SessionSet | null {
  let best: SessionSet | null = null;
  for (const set of exercise.sets) {
    if (!set.isCompleted) continue;
    if (best === null || (set.weightKg ?? 0) > (best.weightKg ?? 0)) {
      best = set;
    }
  }
  return best;
}

function chipLabel(name: string, exercise: SessionExercise, set: SessionSet): string | null {
  if (exercise.measure === 'time' && set.durationSeconds !== null) {
    return `${name} ${set.durationSeconds}s`;
  }
  if (exercise.measure === 'distance' && set.distanceMeters !== null) {
    return `${name} ${set.distanceMeters}m`;
  }
  if (set.reps === null) return null;
  // The prototype's fourth chip is `Dips BW×12`: a set logged without a weight is bodyweight,
  // not "0 kg".
  const load = set.weightKg === null ? 'BW' : String(set.weightKg);
  return `${name} ${load}×${set.reps}`;
}

/**
 * The card's exercise chips -- `Bench 82.5×6`, `Dips BW×12` -- one per exercise, in session
 * order, each naming that exercise's heaviest completed set.
 *
 * An exercise with nothing completed is skipped rather than rendered as an empty chip, and an
 * id the catalogue cannot resolve falls back to a neutral "Exercise": losing the whole card
 * over one unknown id would be a worse trade than one vague chip.
 */
export function sessionExerciseChips(
  session: WorkoutSessionResponse,
  resolveName: (exerciseId: string) => string | null,
): string[] {
  return [...session.exercises]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .flatMap((exercise) => {
      const set = bestCompletedSet(exercise);
      if (set === null) return [];
      const label = chipLabel(resolveName(exercise.exerciseId) ?? 'Exercise', exercise, set);
      return label === null ? [] : [label];
    });
}

/**
 * What the catalogue can tell the repeat builder about an exercise. `goal` is on the catalogue
 * row, never on the session -- a session records what was performed, not how the exercise is
 * classified -- so it has to be resolved rather than carried through.
 */
export interface ResolvedExercise {
  name: string;
  goal: ExerciseGoal | null;
}

/**
 * Turns a finished session back into a startable one for the card's `Repeat` button.
 *
 * Two decisions, each wrong in a specific way if reversed:
 *
 * - **Every set starts unticked.** Carrying the completions over would hand the athlete a
 *   workout that claims to be already finished.
 * - **Every set keeps the load that was logged.** Blanking them would make the athlete retype
 *   every weight they lifted last time, which is most of the value of repeating a workout.
 *   This is why it does not go through `toLiveExercise`: that expands a *prescription*, where
 *   all sets share one target, and would flatten `80×8, 82.5×6, 80×8` into three identical rows.
 *
 * Set indexes are renumbered densely from zero rather than trusted from the response, because
 * `LiveSet.setIndex` is a position in the live screen's own array and everything downstream
 * indexes by it.
 *
 * An exercise the catalogue cannot resolve keeps its place under a neutral name: the athlete
 * still performed it, and dropping it would silently change the workout they asked to repeat.
 */
export function toRepeatExercises(
  session: WorkoutSessionResponse,
  resolveExercise: (exerciseId: string) => ResolvedExercise | null,
): LiveExercise[] {
  return [...session.exercises]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((exercise) => {
      const resolved = resolveExercise(exercise.exerciseId);
      return {
        exerciseId: exercise.exerciseId,
        name: resolved?.name ?? 'Exercise',
        measure: exercise.measure,
        goal: resolved?.goal ?? null,
        sets: exercise.sets.map((set, setIndex) => ({
          setIndex,
          isCompleted: false,
          weightKg: set.weightKg,
          reps: set.reps,
          durationSeconds: set.durationSeconds,
          distanceMeters: set.distanceMeters,
        })),
      };
    });
}
