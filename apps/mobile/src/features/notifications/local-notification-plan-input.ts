import {
  isAnyLadderCloseToTarget,
  planLocalNotifications,
  type PlannedLocalNotification,
  type ProgramWeekdayWorkout,
  type TrainingSessionStart,
} from '@forjd/domain';
import type {
  ForgeResponse,
  NutritionLogListResponse,
  ProgramEnrollmentResponse,
  ProgramResponse,
  WorkoutSessionListResponse,
  WorkoutStatsResponse,
} from '@forjd/contracts';

import {
  getForge,
  getProgram,
  getProgramEnrollment,
  getWorkoutStats,
  listNutritionLog,
  listWorkoutSessions,
} from '@/auth/apiClient';
import { isNotFound } from '@/auth/failure';
import { loadFeatureFlags } from '@/features/flags/feature-flags';
import { WEEKLY_FORGE_FLAG } from '@/features/forge/use-forge-week';
import { loadNotificationPreferences, type NotificationPreferences } from '@/store/notification-preferences';

/**
 * Gathers what the pure planner needs (Phase 12E, ADR-064) and runs it: the switches from the device copy, the
 * last weeks of completed sessions, and a custom program's weekdays. A read that fails answers `null`, meaning
 * "leave the schedule as it is": an empty plan would cancel every reminder just because the phone was offline.
 */
export interface PlanInputSources {
  loadPreferences: () => Promise<NotificationPreferences>;
  listSessions: (query: { limit: number }) => Promise<WorkoutSessionListResponse>;
  getEnrollment: () => Promise<ProgramEnrollmentResponse>;
  getProgram: (id: string) => Promise<ProgramResponse>;
  listNutritionLog: (date: string) => Promise<NutritionLogListResponse>;
  getStats: () => Promise<WorkoutStatsResponse>;
  loadFlags: () => Promise<readonly string[]>;
  getForge: () => Promise<ForgeResponse>;
}

export const defaultPlanInputSources: PlanInputSources = {
  loadPreferences: loadNotificationPreferences,
  listSessions: listWorkoutSessions,
  getEnrollment: getProgramEnrollment,
  getProgram,
  listNutritionLog,
  getStats: getWorkoutStats,
  loadFlags: loadFeatureFlags,
  getForge,
};

/** Enough to cover the planner's four-week window for anyone who trains daily. */
const SESSION_PAGE_SIZE = 100;

const pad = (value: number): string => String(value).padStart(2, '0');
const localDate = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localMinute = (date: Date): number => date.getHours() * 60 + date.getMinutes();

async function readSessionStarts(sources: PlanInputSources): Promise<TrainingSessionStart[]> {
  const { items } = await sources.listSessions({ limit: SESSION_PAGE_SIZE });
  return items
    .filter((session) => session.status === 'completed')
    .map((session) => {
      const started = new Date(session.startedAt);
      return { date: localDate(started), startMinute: localMinute(started) };
    });
}

/** A preset prescribes no weekdays, so only a program the person built contributes any. */
async function readProgramWorkouts(sources: PlanInputSources): Promise<ProgramWeekdayWorkout[]> {
  const { enrollment } = await sources.getEnrollment();
  if (!enrollment) return [];
  const program = await sources.getProgram(enrollment.programId);
  if (!program.isOwn) return [];
  return program.workouts.flatMap((workout) =>
    workout.dayOfWeek === null ? [] : [{ dayOfWeek: workout.dayOfWeek, workoutName: workout.name }],
  );
}

/**
 * Any food logged today, so today's evening reminder is not sent after the person already logged. A read that
 * fails counts as logged: a reminder is never sent for food that may already be in, and the failure does not hold
 * back the other reminders (later days keep theirs).
 */
async function readMealLoggedToday(sources: PlanInputSources, today: string): Promise<boolean> {
  try {
    const { items } = await sources.listNutritionLog(today);
    return items.length > 0;
  } catch {
    return true;
  }
}

/** The streak is only wording in one nudge, so a read that fails just leaves it out. */
async function readWeekStreak(sources: PlanInputSources): Promise<number> {
  try {
    return (await sources.getStats()).weekStreak;
  } catch {
    return 0;
  }
}

/**
 * This Weekly Forge week and whether a ladder is close, or `undefined` when the feature is off (its flag, or a 404
 * from the server): then there is nothing to remind about. Any other failure throws, so the schedule is left alone.
 */
async function readForgeWeek(
  sources: PlanInputSources,
): Promise<{ weekStart: string; closeToTarget: boolean } | undefined> {
  if (!(await sources.loadFlags()).includes(WEEKLY_FORGE_FLAG)) return undefined;
  try {
    const forge = await sources.getForge();
    return { weekStart: forge.weekStart, closeToTarget: isAnyLadderCloseToTarget(forge.ladders) };
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function buildLocalNotificationPlan(
  sources: PlanInputSources = defaultPlanInputSources,
  now: Date = new Date(),
): Promise<PlannedLocalNotification[] | null> {
  try {
    const switches = await sources.loadPreferences();
    // Nothing wanted: no reason to touch the network, and the empty plan clears what was scheduled.
    if (!switches.workout && !switches.weekly && !switches.meals && !switches.noWorkout && !switches.forgeClosing) {
      return [];
    }
    const today = localDate(now);
    const [recentSessions, programWorkouts, mealLoggedToday, weekStreak, forgeWeek] = await Promise.all([
      switches.workout || switches.noWorkout ? readSessionStarts(sources) : [],
      switches.workout ? readProgramWorkouts(sources) : [],
      switches.meals ? readMealLoggedToday(sources, today) : false,
      switches.noWorkout ? readWeekStreak(sources) : 0,
      switches.forgeClosing ? readForgeWeek(sources) : undefined,
    ]);
    return planLocalNotifications({
      now: { date: today, minute: localMinute(now) },
      switches: {
        workout: switches.workout,
        weekly: switches.weekly,
        meals: switches.meals,
        noWorkout: switches.noWorkout,
        forgeClosing: switches.forgeClosing,
      },
      recentSessions,
      programWorkouts,
      mealLoggedToday,
      weekStreak,
      forgeWeek,
    });
  } catch {
    return null;
  }
}
