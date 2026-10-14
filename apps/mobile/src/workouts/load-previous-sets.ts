import type { WorkoutSessionResponse, WorkoutSessionUploadRequest } from '@forjd/contracts';

import { getExerciseHistory, getWorkoutSession } from '@/auth/apiClient';
import { getAccountId } from '@/auth/secureStorage';
import { readPreviousSets, rememberPreviousSets, type StoredPrevious } from '@/store/previous-sets';
import { ensureWorkoutSessionSchema, openWorkoutSessionDb } from '@/store/workout-session';

import { completedSetsFromSession, completedSetsFromUpload, type PreviousSet } from './previous-sets';

/**
 * Last time's sets for the live workout (docs/product/live-prev-column-plan.md). The phone's memory is read first, so
 * PREV and the fill work offline straight away; the server is asked afterwards and only when its latest session with
 * the exercise is newer than what the phone remembers. Nothing here throws: a workout never waits on, or fails over,
 * PREV (rule 6).
 */
export interface PreviousSetsDeps {
  accountId: () => Promise<string | null>;
  readLocal: (accountId: string | null, exerciseId: string) => Promise<StoredPrevious | null>;
  writeLocal: (accountId: string | null, exerciseId: string, performedAt: string, sets: PreviousSet[]) => Promise<void>;
  /** The newest session with the exercise on the server, or `null` when there is none. */
  latestSession: (exerciseId: string) => Promise<{ sessionId: string; performedAt: string } | null>;
  getSession: (sessionId: string) => Promise<WorkoutSessionResponse>;
}

async function workoutLogDb() {
  const db = await openWorkoutSessionDb();
  await ensureWorkoutSessionSchema(db);
  return db;
}

const defaultDeps: PreviousSetsDeps = {
  accountId: getAccountId,
  readLocal: async (accountId, exerciseId) => readPreviousSets(await workoutLogDb(), accountId, exerciseId),
  writeLocal: async (accountId, exerciseId, performedAt, sets) =>
    rememberPreviousSets(await workoutLogDb(), accountId, exerciseId, performedAt, sets),
  latestSession: async (exerciseId) => {
    const [latest] = (await getExerciseHistory(exerciseId, 1)).sessions;
    return latest ? { sessionId: latest.sessionId, performedAt: latest.performedAt } : null;
  },
  getSession: getWorkoutSession,
};

const newer = (a: string, b: string): boolean => new Date(a).getTime() > new Date(b).getTime();

async function loadOne(
  exerciseId: string,
  accountId: string | null,
  onUpdate: (exerciseId: string, sets: PreviousSet[]) => void,
  deps: PreviousSetsDeps,
): Promise<void> {
  const local = await deps.readLocal(accountId, exerciseId).catch(() => null);
  if (local && local.sets.length > 0) onUpdate(exerciseId, local.sets);
  try {
    const latest = await deps.latestSession(exerciseId);
    if (!latest || (local && !newer(latest.performedAt, local.performedAt))) return;
    const sets = completedSetsFromSession(await deps.getSession(latest.sessionId), exerciseId);
    if (!sets) return;
    await deps.writeLocal(accountId, exerciseId, latest.performedAt, sets).catch(() => undefined);
    onUpdate(exerciseId, sets);
  } catch {
    // Offline or the server failed: the memory (if any) is already showing.
  }
}

/** Calls `onUpdate` with each exercise's last sets as they become known: once from the phone, again if the server has newer. */
export async function loadPreviousSets(
  exerciseIds: readonly string[],
  onUpdate: (exerciseId: string, sets: PreviousSet[]) => void,
  deps: PreviousSetsDeps = defaultDeps,
): Promise<void> {
  try {
    const accountId = await deps.accountId();
    await Promise.all([...new Set(exerciseIds)].map((id) => loadOne(id, accountId, onUpdate, deps)));
  } catch {
    // No account readable: PREV stays "—".
  }
}

/**
 * On Finish: the workout's completed sets become last time's straight away, before it has even uploaded. Dated by the
 * workout's start, the time the server's history dates a session by, so the newer-wins comparison in `loadOne` and in
 * the store always compares like with like.
 */
export async function rememberFinishedWorkout(
  request: WorkoutSessionUploadRequest,
  deps: PreviousSetsDeps = defaultDeps,
): Promise<void> {
  try {
    const accountId = await deps.accountId();
    const performedAt = request.startedAt;
    for (const [exerciseId, sets] of completedSetsFromUpload(request)) {
      await deps.writeLocal(accountId, exerciseId, performedAt, sets).catch(() => undefined);
    }
  } catch {
    // Nothing to surface: the next workout falls back to the server.
  }
}
