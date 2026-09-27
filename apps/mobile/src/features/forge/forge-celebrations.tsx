import { FORGE_LADDER_IS_PUBLIC } from '@forjd/domain';
import { useEffect, useState } from 'react';

import { hapticLevelUp } from '@/components/haptics';
import { TOAST_DURATION_MS } from '@/components/toast';
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
 * - **A new band or Forged** will get its full screen in Phase 10B; until then those weeks open the
 *   sheet directly, which still shows the "New band" result.
 * - **A cooled or quiet week** opens the sheet directly: no celebration, no red.
 *
 * Rendered after Home's ScrollView, so the toast and the sheet sit over the screen. Everything it
 * shows comes from `usePendingForgeWeeks`, which renders nothing while the feature is off.
 */
export function ForgeCelebrations() {
  const { current, isAcking, acknowledge } = usePendingForgeWeeks();
  const [toastWeek, setToastWeek] = useState<string | null>(null);
  const [sheetWeek, setSheetWeek] = useState<string | null>(null);

  useEffect(() => {
    if (!current) {
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

  const levelUp = current.ladders.find((ladder) => ladder.ladder === current.biggestLadder);
  if (toastWeek === current.weekStart && levelUp) {
    return <ForgeToast ladder={levelUp.ladder} band={levelUp.bandAfter} message={toastLine(levelUp)} />;
  }
  if (sheetWeek === current.weekStart) {
    return <WeekSummarySheet week={current} isBusy={isAcking} onDone={() => void acknowledge(current.weekStart)} />;
  }
  return null;
}
