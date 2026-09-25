import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import type { ActivityLevel } from '@forjd/domain';

import { getMe, updateProfile } from '@/auth/apiClient';
import { ChoicePage, isFirstRun } from '@/features/targets/choice-page';
import { ACTIVITY_LEVEL_OPTIONS } from '@/features/targets/labels';

/**
 * "How active are you?" (docs/product/scan-height-age-plan.md §4.5; approved 2026-09-25). At
 * sign-up it follows Goals and continues to the body goal; from Profile it saves and returns.
 * The level multiplies BMR into maintenance energy for the suggested daily targets.
 */
export default function ActivityLevelScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const firstRun = isFirstRun(returnTo);

  const loadInitial = useCallback(async () => {
    const me = await getMe();
    // The approved sign-up page starts on Active; a saved level always wins.
    return { value: (me.profile?.activityLevel ?? 'active') as ActivityLevel, note: null };
  }, []);

  return (
    <ChoicePage<ActivityLevel>
      title={firstRun ? 'How active are you?' : 'Activity level'}
      subtitle={
        firstRun
          ? 'Your average week, training and daily life together. This sets your daily energy, so FORJD can suggest calorie targets.'
          : 'Your average week, training and daily life together. Used for your suggested calories.'
      }
      sectionLabel="Activity level"
      options={ACTIVITY_LEVEL_OPTIONS}
      loadInitial={loadInitial}
      save={async (activityLevel) => {
        await updateProfile({ activityLevel });
      }}
      buttonLabel={firstRun ? 'Continue' : 'Save'}
      failureMessage="Could not save your activity level. Please try again."
      onBack={() => router.replace(firstRun ? '/goals?returnTo=newAccount' : '/profile')}
      onSaved={(showToast) => {
        if (firstRun) {
          router.replace('/body-goal?returnTo=newAccount');
        } else {
          showToast('Activity level updated');
          router.replace('/profile');
        }
      }}
      footnote={
        firstRun
          ? 'You can change this any time in Profile.'
          : 'Saving changes the suggestion on Nutrition. Your daily targets stay as they are until you tap Use there.'
      }
    />
  );
}
