import { router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import type { BodyGoal, TrainingGoal } from '@forjd/domain';

import { getMe, updateProfile } from '@/auth/apiClient';
import { ChoicePage, isFirstRun } from '@/features/targets/choice-page';
import { BODY_GOAL_OPTIONS } from '@/features/targets/labels';

/**
 * The body goal a new account starts on, read from its training goals (the approved design):
 * losing fat while getting stronger or building muscle is recomposition.
 */
export function goalFromTrainingGoals(goals: readonly TrainingGoal[]): BodyGoal {
  const loseFat = goals.includes('lose_fat');
  const gain = goals.includes('build_muscle') || goals.includes('get_stronger');
  if (loseFat && gain) return 'recomposition';
  if (loseFat) return 'lose_fat';
  if (goals.includes('build_muscle')) return 'build_muscle';
  return 'maintain';
}

/**
 * "What's your goal?" (docs/product/scan-height-age-plan.md §4.5; approved 2026-09-25): the last
 * sign-up page, and the Profile "Body goal" row. It sets whether the suggested calories sit below,
 * at, or above maintenance.
 */
export default function BodyGoalScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const firstRun = isFirstRun(returnTo);

  const loadInitial = useCallback(async () => {
    const me = await getMe();
    const saved = me.profile?.bodyGoal ?? null;
    if (saved) return { value: saved, note: null };
    return {
      value: goalFromTrainingGoals(me.profile?.trainingGoals ?? []),
      note: firstRun ? 'Picked from your training goals. Change it here or later in Profile.' : null,
    };
  }, [firstRun]);

  return (
    <ChoicePage<BodyGoal>
      title={firstRun ? "What's your goal?" : 'Body goal'}
      subtitle={
        firstRun
          ? 'Sets whether your suggested calories sit below, at, or above maintenance. You always confirm targets before they change.'
          : 'Whether your suggested calories sit below, at, or above maintenance.'
      }
      sectionLabel="Body weight"
      options={BODY_GOAL_OPTIONS}
      loadInitial={loadInitial}
      save={async (bodyGoal) => {
        await updateProfile({ bodyGoal });
      }}
      buttonLabel={firstRun ? 'Finish' : 'Save'}
      failureMessage="Could not save your goal. Please try again."
      onBack={() => router.replace(firstRun ? '/activity-level?returnTo=newAccount' : '/profile')}
      onSaved={(showToast) => {
        if (firstRun) {
          showToast('Welcome to FORJD!');
          router.replace('/');
        } else {
          showToast('Goal updated');
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
