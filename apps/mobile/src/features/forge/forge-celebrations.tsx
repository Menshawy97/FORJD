import type { ForgeWeekSummary } from '@forjd/contracts';
import { FORGE_LADDER_IS_PUBLIC } from '@forjd/domain';
import { useEffect, useRef, useState } from 'react';

import { hapticLevelUp } from '@/components/haptics';
import { TOAST_DURATION_MS } from '@/components/toast';
import { ForgeCelebrationScreen } from './forge-celebration-screen';
import { toastLine } from './forge-copy';
import { ForgeToast } from './forge-toast';
import { usePendingForgeWeeks } from './use-pending-forge-weeks';
import { WeekSummarySheet } from './week-summary-sheet';

/**
 * Home's Weekly Forge celebrations (Phase 7 items D, G and H). For each closed week not yet seen,
 * oldest first, the week's one celebration plays and then its summary sheet opens; Done
 * acknowledges the week and the next one begins.
 *
 * - **A new level** shows the toast for the app's usual 1.9 s, with a light tap, then the sheet.
 *   Nourish stays calm: a plain toast and no tap.
 * - **A new band or Forged** plays its full screen (`ForgeCelebrationScreen`); Continue opens the
 *   sheet. Nourish never gets one: the server never marks a Nourish week as a band celebration.
 * - **A cooled or quiet week** opens the sheet directly: no celebration, no red.
 *
 * Rendered after Home's ScrollView, so the toast and the sheet sit over the screen. Everything it
 * shows comes from `usePendingForgeWeeks`, which renders nothing while the feature is off.
 */
/** Long enough for a fading Modal to finish dismissing before the next one is presented. */
export const MODAL_HANDOFF_MS = 350;

export function ForgeCelebrations() {
  const { current, isAcking, acknowledge } = usePendingForgeWeeks();
  const [screenWeek, setScreenWeek] = useState<string | null>(null);
  const [toastWeek, setToastWeek] = useState<string | null>(null);
  const [sheetWeek, setSheetWeek] = useState<string | null>(null);
  const handoff = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (handoff.current) {
        clearTimeout(handoff.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!current) {
      return undefined;
    }
    if (
      (current.biggest === 'band' || current.biggest === 'forged') &&
      biggestLadderWeek(current)
    ) {
      setScreenWeek(current.weekStart);
      return undefined;
    }
    const levelUp =
      current.biggest === 'level' && current.biggestLadder !== null
        ? current.ladders.find((ladder) => ladder.ladder === current.biggestLadder)
        : undefined;
    if (!levelUp) {
      setSheetWeek(current.weekStart);
      return undefined;
    }
    setToastWeek(current.weekStart);
    if (FORGE_LADDER_IS_PUBLIC[levelUp.ladder]) {
      void hapticLevelUp();
    }
    const timer = setTimeout(() => {
      setToastWeek(null);
      setSheetWeek(current.weekStart);
    }, TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [current]);

  if (!current) {
    return null;
  }

  const celebrated = biggestLadderWeek(current);
  if (screenWeek === current.weekStart && celebrated) {
    return (
      <ForgeCelebrationScreen
        week={current}
        ladderWeek={celebrated}
        onContinue={() => {
          // One Modal at a time: the celebration closes, and the sheet opens once its dismissal has
          // finished. Presenting a Modal while another is still animating away can drop it on iOS.
          setScreenWeek(null);
          const weekStart = current.weekStart;
          handoff.current = setTimeout(() => setSheetWeek(weekStart), MODAL_HANDOFF_MS);
        }}
      />
    );
  }
  if (toastWeek === current.weekStart && celebrated) {
    return (
      <ForgeToast
        ladder={celebrated.ladder}
        band={celebrated.bandAfter}
        message={toastLine(celebrated)}
      />
    );
  }
  if (sheetWeek === current.weekStart) {
    return (
      <WeekSummarySheet
        week={current}
        isBusy={isAcking}
        onDone={() => void acknowledge(current.weekStart)}
      />
    );
  }
  return null;
}

/** The ladder that earned the week's one celebration, if any. */
function biggestLadderWeek(
  week: ForgeWeekSummary,
): ForgeWeekSummary['ladders'][number] | undefined {
  return week.biggestLadder === null
    ? undefined
    : week.ladders.find((ladder) => ladder.ladder === week.biggestLadder);
}
