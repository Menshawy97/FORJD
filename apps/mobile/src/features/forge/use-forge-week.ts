import type { ForgeResponse } from '@forjd/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { getForge } from '@/auth/apiClient';
import { isNotFound } from '@/auth/failure';
import { getAccountId } from '@/auth/secureStorage';
import { useFeatureFlag } from '@/features/flags/feature-flags';

/** The server-side flag that keeps Weekly Forge dark until it is switched on (ADR-057). */
export const WEEKLY_FORGE_FLAG = 'weekly_forge';

export interface ForgeWeekState {
  /** False while the flag is off, or after the server answered 404 (the feature is switched off). */
  isVisible: boolean;
  /** This week, or null before the first answer (and after failures with no earlier answer). */
  forge: ForgeResponse | null;
  /**
   * The week could not be read and there is nothing to show yet. False while the first read is in
   * flight, and after any success: a later failure keeps the last good week instead. Lets the ladder
   * screen tell "loading" from "could not load" (weekly-forge-explainer-plan.md X3).
   */
  loadFailed: boolean;
  /** Reads the week again, for pull-to-refresh. */
  reload: () => Promise<void>;
}

/**
 * This week on every Weekly Forge ladder, for the screens that show it (Home's card, the profile
 * section, How it works and the ladder screen). One copy of the rules in the bug checklist
 * (docs/product/weekly-forge-plan.md):
 *
 * - **The flag gates everything.** Off, nothing is requested. A 404 from `GET /forge` means the
 *   server has the feature switched off, and hides it too.
 * - **Loads on every focus**, so a workout just finished shows at once.
 * - **Stale answers are dropped.** Each load takes a generation number that a blur or a newer load
 *   invalidates, and an answer is kept only if the account signed in when it arrives is the one
 *   that asked (the late-`getMe` bug the Phase 8.5 review found).
 * - **A failed refresh keeps the last good week** instead of blanking it.
 */
export function useForgeWeek(): ForgeWeekState {
  const isEnabled = useFeatureFlag(WEEKLY_FORGE_FLAG);
  const [forge, setForge] = useState<ForgeResponse | null>(null);
  const [isSwitchedOff, setIsSwitchedOff] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const generation = useRef(0);
  const hasWeek = useRef(false);

  const load = useCallback(async () => {
    const current = (generation.current += 1);
    // Caught here, not later: a rejection left unobserved while `getForge` runs would be reported
    // as unhandled. An unreadable account reads as null on both sides, which still compares.
    const accountAtStart = getAccountId().catch(() => null);
    try {
      const next = await getForge();
      const [startedAs, finishedAs] = await Promise.all([accountAtStart, getAccountId().catch(() => null)]);
      if (current !== generation.current || startedAs !== finishedAs) {
        return;
      }
      hasWeek.current = true;
      setIsSwitchedOff(false);
      setLoadFailed(false);
      setForge(next);
    } catch (error) {
      if (current !== generation.current) {
        return;
      }
      if (isNotFound(error)) {
        setIsSwitchedOff(true);
        return;
      }
      // Any other failure keeps what is already shown: the last good week, or nothing yet.
      if (!hasWeek.current) {
        setLoadFailed(true);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isEnabled) {
        return undefined;
      }
      void load();
      return () => {
        generation.current += 1;
      };
    }, [isEnabled, load]),
  );

  return { isVisible: isEnabled && !isSwitchedOff, forge, loadFailed, reload: load };
}
