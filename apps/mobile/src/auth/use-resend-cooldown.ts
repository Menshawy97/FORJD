import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The "Resend email" button's countdown. `start()` begins it at `seconds`; it ticks once a
 * second and rests at zero. The server also limits resends (three per fifteen minutes), so this
 * is the courtesy in front of that limit, not the enforcement of it.
 */
export function useResendCooldown(seconds: number): { secondsLeft: number; start: () => void } {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    setSecondsLeft(seconds);
    timer.current = setInterval(() => setSecondsLeft((left) => Math.max(left - 1, 0)), 1000);
  }, [seconds, stop]);

  // The interval only ever counts down, so it is switched off here once it reaches zero rather
  // than from inside the state updater (which React may call more than once).
  useEffect(() => {
    if (secondsLeft === 0) stop();
  }, [secondsLeft, stop]);

  useEffect(() => stop, [stop]);

  return { secondsLeft, start };
}
