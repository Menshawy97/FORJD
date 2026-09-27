import { useForgeWeek } from './use-forge-week';
import { WeeklyForgeCard } from './weekly-forge-card';

/**
 * Home's Weekly Forge section: the approved card, fed by `useForgeWeek`, which owns the flag, the
 * loading and the stale-answer guards. Renders nothing while the feature is off; before the first
 * answer the card draws its dashes.
 */
export function WeeklyForgeSection() {
  const { isVisible, forge } = useForgeWeek();
  return isVisible ? <WeeklyForgeCard forge={forge} /> : null;
}
