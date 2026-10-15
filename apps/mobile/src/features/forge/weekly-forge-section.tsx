import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { openForgeHowItWorksOnce } from './open-how-it-works-once';
import { useForgeWeek } from './use-forge-week';
import { WeeklyForgeCard } from './weekly-forge-card';

/**
 * Home's Weekly Forge section: the approved card, fed by `useForgeWeek`, which owns the flag, the
 * loading and the stale-answer guards. Renders nothing while the feature is off; before the first
 * answer the card draws its dashes.
 *
 * The first time the card shows a week, How it works opens by itself, once
 * (docs/product/forge-how-it-works-once-plan.md). It waits for the week so a server that answers
 * 404 (feature off) never opens it.
 */
export function WeeklyForgeSection() {
  const { isVisible, forge } = useForgeWeek();
  const isShowingWeek = isVisible && forge !== null;

  useFocusEffect(
    useCallback(() => {
      if (isShowingWeek) {
        void openForgeHowItWorksOnce();
      }
    }, [isShowingWeek]),
  );

  return isVisible ? <WeeklyForgeCard forge={forge} /> : null;
}
