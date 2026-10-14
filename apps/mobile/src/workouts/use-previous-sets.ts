import { useEffect, useRef, useState } from 'react';

import { activeWorkout } from './active-workout';
import type { LiveSession, LiveSet } from './live-session';
import { loadPreviousSets } from './load-previous-sets';
import { prefillFromPrevious, type PreviousSet } from './previous-sets';

/**
 * Last time's sets for each exercise in the live workout, for the PREV column, and the one-time fill of today's sets
 * (docs/product/live-prev-column-plan.md). Loads each exercise once per workout, including one added mid-workout, in
 * the background: nothing here holds the workout up (rule 6).
 *
 * The fill happens once per exercise, the first time its sets are known, and only into sets still exactly as the
 * workout laid them out (`prefillFromPrevious`). A later, newer answer only updates PREV. A workout picked back up
 * after the app closed is not filled again: its values are already the person's.
 */
export function usePreviousSets(session: LiveSession | null, resumed: boolean): Record<string, PreviousSet[]> {
  const [previous, setPrevious] = useState<Record<string, PreviousSet[]>>({});
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sessionIdRef = useRef<string | null>(null);
  const requested = useRef(new Set<string>());
  const laidOut = useRef(new Map<string, LiveSet[]>());
  const filled = useRef(new Set<string>());

  const sessionId = session?.id ?? null;
  const exerciseKey = session ? session.exercises.map((exercise) => exercise.exerciseId).join('|') : '';

  useEffect(() => {
    const current = sessionRef.current;
    if (!current) return;
    if (sessionIdRef.current !== current.id) {
      sessionIdRef.current = current.id;
      requested.current = new Set();
      laidOut.current = new Map();
      filled.current = new Set(resumed ? current.exercises.map((exercise) => exercise.exerciseId) : []);
      setPrevious({});
    }

    const fresh: string[] = [];
    for (const exercise of current.exercises) {
      if (!laidOut.current.has(exercise.exerciseId)) laidOut.current.set(exercise.exerciseId, exercise.sets);
      if (!requested.current.has(exercise.exerciseId)) {
        requested.current.add(exercise.exerciseId);
        fresh.push(exercise.exerciseId);
      }
    }
    if (fresh.length === 0) return;

    const forSession = current.id;
    void loadPreviousSets(fresh, (exerciseId, sets) => {
      if (sessionIdRef.current !== forSession) return;
      setPrevious((shown) => ({ ...shown, [exerciseId]: sets }));
      if (filled.current.has(exerciseId)) return;
      filled.current.add(exerciseId);
      const original = laidOut.current.get(exerciseId) ?? [];
      activeWorkout.update((live) => {
        if (live.id !== forSession) return live;
        const index = live.exercises.findIndex((exercise) => exercise.exerciseId === exerciseId);
        return index < 0 ? live : prefillFromPrevious(live, index, sets, original);
      });
    });
    // The session object changes with every keystroke; only a new workout or a new exercise matters here.
  }, [sessionId, exerciseKey, resumed]);

  return previous;
}
