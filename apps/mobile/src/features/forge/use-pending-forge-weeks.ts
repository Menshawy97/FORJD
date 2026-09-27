import type { ForgeWeekSummary } from '@forjd/contracts';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { ackForgeWeek, getPendingForgeWeeks } from '@/auth/apiClient';
import { getAccountId } from '@/auth/secureStorage';
import { useFeatureFlag } from '@/features/flags/feature-flags';
import { WEEKLY_FORGE_FLAG } from './use-forge-week';

export interface PendingForgeWeeks {
  /** The oldest closed week not yet seen, or null when there is none (or the flag is off). */
  current: ForgeWeekSummary | null;
  /** True while an acknowledgement is on its way. */
  isAcking: boolean;
  /** Marks a week as seen and moves on to the next. Never throws; a second call while busy is ignored. */
  acknowledge: (weekStart: string) => Promise<void>;
}

/**
 * The closed Weekly Forge weeks waiting to be celebrated on Home, oldest first, following the bug
 * checklist in docs/product/weekly-forge-plan.md:
 *
 * - **Flag-gated.** Nothing is requested while `weekly_forge` is off; a 404 or a failed read just
 *   means there is nothing to show.
 * - **Loaded on Home focus**, with the stale-load and same-account guards `useForgeWeek` uses. Not
 *   asked again while a week is still on screen, so a flow is never swapped out from under the user.
 * - **Acknowledged once.** A second Done while the first is on its way is ignored. A week whose
 *   acknowledgement failed is closed for the rest of this app run, and the server, which still
 *   counts it unseen, shows it again next launch: shown once more rather than lost.
 */
export function usePendingForgeWeeks(): PendingForgeWeeks {
  const isEnabled = useFeatureFlag(WEEKLY_FORGE_FLAG);
  const [weeks, setWeeks] = useState<readonly ForgeWeekSummary[]>([]);
  const [isAcking, setIsAcking] = useState(false);
  const queue = useRef<readonly ForgeWeekSummary[]>([]);
  const acking = useRef(false);
  const closedThisRun = useRef(new Set<string>());
  const generation = useRef(0);

  const replaceQueue = useCallback((next: readonly ForgeWeekSummary[]) => {
    queue.current = next;
    setWeeks(next);
  }, []);

  const load = useCallback(async () => {
    if (queue.current.length > 0) {
      return;
    }
    const current = (generation.current += 1);
    // Caught here: a rejection left unobserved while the request runs would be reported as unhandled.
    const accountAtStart = getAccountId().catch(() => null);
    try {
      const { weeks: next } = await getPendingForgeWeeks();
      const [startedAs, finishedAs] = await Promise.all([accountAtStart, getAccountId().catch(() => null)]);
      if (current !== generation.current || startedAs !== finishedAs) {
        return;
      }
      replaceQueue(next.filter((week) => !closedThisRun.current.has(week.weekStart)));
    } catch {
      // Switched off (404) or unreachable: there is simply nothing to celebrate right now.
    }
  }, [replaceQueue]);

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

  const acknowledge = useCallback(
    async (weekStart: string) => {
      if (acking.current) {
        return;
      }
      acking.current = true;
      setIsAcking(true);
      try {
        await ackForgeWeek(weekStart);
      } catch {
        closedThisRun.current.add(weekStart);
      } finally {
        acking.current = false;
        setIsAcking(false);
        replaceQueue(queue.current.filter((week) => week.weekStart !== weekStart));
      }
    },
    [replaceQueue],
  );

  return { current: isEnabled ? (weeks[0] ?? null) : null, isAcking, acknowledge };
}
