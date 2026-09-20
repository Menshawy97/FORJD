import { readCoarsePosition, type CoarsePosition } from '@/integrations/location/location-provider';
import { readLocationConsent } from '@/store/leaderboard-consent';

/**
 * What a starting workout does about location (ADR-048): read one coarse position if, and only if,
 * the signed-in person allowed location for leaderboards, and otherwise nothing.
 *
 * Four things it deliberately does not do:
 *
 * - **It never prompts.** The adapter's `readCoarsePosition` only checks the permission that the
 *   Location screen already obtained, so nothing here can raise a system dialog mid-workout.
 * - **It never touches the network.** Whether location is allowed comes from the device's own copy
 *   of the consent, which Home, the Location screen and the Privacy screen keep true from the
 *   server's answers. A request from here could, in a rare refresh failure, force a sign-out in the
 *   middle of a set (CLAUDE.md rule 6). When the device does not know yet (a fresh sign-in, before
 *   Home has loaded) the answer is simply "no position this time".
 * - **It is never awaited by the workout.** The screen starts first and calls this afterwards.
 * - **It never throws.** Any failure is a workout with no position, and no position is a workout
 *   with no city, which is a valid outcome.
 */
export async function captureStartLocation(): Promise<CoarsePosition | null> {
  try {
    if ((await readLocationConsent()) !== true) {
      return null;
    }
    return await readCoarsePosition();
  } catch {
    return null;
  }
}
