import type { ForgeResponse } from '@forjd/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { getForge } from '@/auth/apiClient';
import { isNotFound } from '@/auth/failure';
import { getAccountId } from '@/auth/secureStorage';
import { useFeatureFlag } from '@/features/flags/feature-flags';
import { WeeklyForgeCard } from './weekly-forge-card';

/** The server-side flag that keeps Weekly Forge dark until it is switched on (ADR-057). */
export const WEEKLY_FORGE_FLAG = 'weekly_forge';

/**
 * Home's Weekly Forge section: the approved card (`WeeklyForgeCard`), plus everything around it
 * that decides what the card shows. Following the bug checklist in
 * docs/product/weekly-forge-plan.md:
 *
 * - **The flag gates everything.** Off, it renders nothing and asks for nothing. A 404 from
 *   `GET /forge` means the server has the feature switched off, and hides it too.
 * - **Loads on every focus**, like the rest of Home, so a workout just finished shows at once.
 * - **Stale answers are dropped.** Each load takes a generation number that a blur or a newer load
 *   invalidates, and an answer is kept only if the account signed in when it arrives is the one
 *   that asked (the late-`getMe` bug the Phase 8.5 review found).
 * - **A failed refresh keeps the last good week** instead of blanking it; before any answer, the
 *   card draws its dashes.
 */
export function WeeklyForgeSection() {
  const isEnabled = useFeatureFlag(WEEKLY_FORGE_FLAG);
  const [forge, setForge] = useState<ForgeResponse | null>(null);
  const [isSwitchedOff, setIsSwitchedOff] = useState(false);
  const generation = useRef(0);

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
      setIsSwitchedOff(false);
      setForge(next);
    } catch (error) {
      if (current === generation.current && isNotFound(error)) {
        setIsSwitchedOff(true);
      }
      // Any other failure keeps whatever the card already shows: the last good week, or dashes.
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

  if (!isEnabled || isSwitchedOff) {
    return null;
  }
  return <WeeklyForgeCard forge={forge} />;
}
