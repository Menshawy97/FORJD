import { useSyncExternalStore } from 'react';

import { activeWorkout, type ActiveWorkoutState } from './active-workout';

/**
 * The active workout, as React state. The store hands out one state object per change, so this re-renders
 * exactly when the workout does, and every reader (the live screen, the in-app bar) sees the same one.
 */
export function useActiveWorkout(): ActiveWorkoutState {
  return useSyncExternalStore(
    (onChange) => activeWorkout.subscribe(() => onChange()),
    activeWorkout.getState,
    activeWorkout.getState,
  );
}
