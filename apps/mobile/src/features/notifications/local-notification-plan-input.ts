import {
  planLocalNotifications,
  type PlannedLocalNotification,
  type ProgramWeekdayWorkout,
  type TrainingSessionStart,
} from '@forjd/domain';
import type { ProgramEnrollmentResponse, ProgramResponse, WorkoutSessionListResponse } from '@forjd/contracts';

import { getProgram, getProgramEnrollment, listWorkoutSessions } from '@/auth/apiClient';
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
}

export const defaultPlanInputSources: PlanInputSources = {
  loadPreferences: loadNotificationPreferences,
  listSessions: listWorkoutSessions,
  getEnrollment: getProgramEnrollment,
  getProgram,
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

export async function buildLocalNotificationPlan(
  sources: PlanInputSources = defaultPlanInputSources,
  now: Date = new Date(),
): Promise<PlannedLocalNotification[] | null> {
  try {
    const switches = await sources.loadPreferences();
    // Nothing wanted: no reason to touch the network, and the empty plan clears what was scheduled.
    if (!switches.workout && !switches.weekly) return [];
    const [recentSessions, programWorkouts] = await Promise.all([
      switches.workout ? readSessionStarts(sources) : [],
      switches.workout ? readProgramWorkouts(sources) : [],
    ]);
    return planLocalNotifications({
      now: { date: localDate(now), minute: localMinute(now) },
      switches: { workout: switches.workout, weekly: switches.weekly },
      recentSessions,
      programWorkouts,
    });
  } catch {
    return null;
  }
}
