import { useCallback, useRef, useState } from 'react';

/**
 * Runs a task at most once at a time, for a save button (whole-app review 8.5, L4-1). A second
 * `run` while the first is still in flight is ignored rather than queued: a double tap on "Add to
 * Log" used to log the food twice, doubling its calories and macros for the day.
 *
 * The lock is a ref, not state, so a second tap landing in the same frame is already blocked before
 * any re-render; `isRunning` is state only so the button can show itself as busy. A failed task
 * releases the lock and its error reaches the caller unchanged.
 */
export function useSingleFlight(): { run: (task: () => Promise<void>) => Promise<void>; isRunning: boolean } {
  const inFlight = useRef(false);
  const [isRunning, setIsRunning] = useState(false);

  const run = useCallback(async (task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsRunning(true);
    try {
      await task();
    } finally {
      inFlight.current = false;
      setIsRunning(false);
    }
  }, []);

  return { run, isRunning };
}
