import { useSyncExternalStore } from 'react';

import { activeWorkout, type ActiveWorkoutState } from './active-workout';

// Module-level, so React keeps one subscription instead of dropping and re-adding it on every render.
const subscribe = (onChange: () => void) => activeWorkout.subscribe(() => onChange());

/**
 * The active workout, as React state. The store hands out one state object per change, so this re-renders
 * exactly when the workout does, and every reader (the live screen, the in-app bar) sees the same one.
 */
export function useActiveWorkout(): ActiveWorkoutState {
  return useSyncExternalStore(subscribe, activeWorkout.getState, activeWorkout.getState);
}

/** Whether a workout is running or paused: the bar shows, so the screens underneath leave room for it. */
export function useHasActiveWorkout(): boolean {
  const { session } = useActiveWorkout();
  return session !== null && session.status !== 'completed';
}
