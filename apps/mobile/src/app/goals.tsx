import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { UpdateProfileRequest } from '@forjd/contracts';
import type { Activity, TrainingGoal } from '@forjd/domain';

import { getMe, updateProfile } from '@/auth/apiClient';
import { classifyRequestFailure, OFFLINE_MESSAGE } from '@/auth/failure';
import { Icon } from '@/components/icon';
import { pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { colors } from '@/theme/tokens';

// docs/design/slice2-screen-specs.md §4. No `hdr()` — a bare back bar — and no tab bar.
// The multi-select `pick()` control (§4.4) is bespoke to this screen; nothing else in the
// app has a checkbox-style row with an inline check glyph.

const GOAL_OPTIONS: ReadonlyArray<{ value: TrainingGoal; label: string }> = [
  { value: 'get_stronger', label: 'Get stronger' },
  { value: 'lose_fat', label: 'Lose fat' },
  { value: 'build_muscle', label: 'Build muscle' },
  { value: 'improve_endurance', label: 'Improve endurance' },
  { value: 'feel_better', label: 'Feel better' },
];

const ACTIVITY_OPTIONS: ReadonlyArray<{ value: Activity; label: string }> = [
  { value: 'strength', label: 'Strength' },
  { value: 'running', label: 'Running' },
  { value: 'hyrox', label: 'HYROX' },
  { value: 'pilates', label: 'Pilates' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'swimming', label: 'Swimming' },
];

function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function describeFailure(error: unknown): string {
  return classifyRequestFailure(error) === 'offline'
    ? OFFLINE_MESSAGE
    : 'Could not update your goals. Please try again.';
}

/**
 * `goalsReturnTo`, ported as a `returnTo` query param rather than app state (§4.6, §4.8 —
 * navigation state the spec says not to port). `'newAccount'` is the one value that changes
 * behaviour: the first-run path lands on home with the welcome toast and its back chevron
 * returns to `signup`, matching the prototype's documented "back-chevron trap" exactly.
 * Every other value (including absent — profile's own `goGoals` binding never sets it)
 * behaves like the prototype's default `'profile'`.
 */
export default function GoalsScreen() {
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const firstRun = returnTo === 'newAccount';

  const [goals, setGoals] = useState<TrainingGoal[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    getMe().then(
      (me) => {
        if (cancelled) return;
        if (me.profile) {
          setGoals([...me.profile.trainingGoals]);
          setActivities([...me.profile.activities]);
        }
        setLoaded(true);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setLoadError(describeFailure(cause));
        setLoaded(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const goBack = () => router.replace(firstRun ? '/signup' : '/profile');
  const ready = goals.length > 0 && activities.length > 0;

  const handleSave = async () => {
    if (!ready) return;
    setSaveError(null);
    setSaving(true);
    const patch: UpdateProfileRequest = { trainingGoals: goals, activities };
    try {
      await updateProfile(patch);
      if (firstRun) {
        toast.show('Welcome to FORJD!');
        router.replace('/');
      } else {
        toast.show('Goals updated');
        router.replace('/profile');
      }
    } catch (cause) {
      setSaveError(describeFailure(cause));
      setSaving(false);
    }
  };

  return (
    <ScreenBackground>
      <View className="flex-none px-screen-x pt-[14px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          className="h-[34px] w-[34px] items-center justify-center rounded-[10px]"
          style={({ pressed }) => [
            { marginLeft: -8 },
            pressed && { backgroundColor: colors.pressedGhost },
          ]}>
          <Icon name="back" />
        </Pressable>
      </View>

      {loadError && (
        <Text className="mt-3 px-screen-x font-archivo text-inline-error font-medium text-errorText">
          {loadError}
        </Text>
      )}

      {loaded && !loadError && (
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-screen-x pb-[26px]"
          showsVerticalScrollIndicator={false}>
          <Text
            className="mt-[18px] font-archivo text-screen-header font-bold text-text"
            style={{ letterSpacing: -0.02 * 26 }}>
            What are you training for?
          </Text>
          <Text className="mb-[22px] mt-[10px] font-archivo text-body text-dim">
            Pick everything that applies. This shapes your programs, insights and
            leaderboards.
          </Text>

          <Text className="mb-[10px] font-archivo text-section-label font-semibold uppercase text-label">
            Goals
          </Text>
          <View style={{ gap: 8 }}>
            {GOAL_OPTIONS.map((option) => (
              <PickRow
                key={option.value}
                label={option.label}
                selected={goals.includes(option.value)}
                onPress={() => setGoals((current) => toggleIn(current, option.value))}
              />
            ))}
          </View>

          <Text className="mb-[10px] mt-[22px] font-archivo text-section-label font-semibold uppercase text-label">
            Activities
          </Text>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {ACTIVITY_OPTIONS.map((option) => (
              <View key={option.value} style={{ width: '48%' }}>
                <PickRow
                  label={option.label}
                  selected={activities.includes(option.value)}
                  onPress={() => setActivities((current) => toggleIn(current, option.value))}
                />
              </View>
            ))}
          </View>

          {saveError && (
            <Text className="mt-[16px] font-archivo text-inline-error font-medium text-errorText">
              {saveError}
            </Text>
          )}
        </ScrollView>
      )}

      {loaded && !loadError && (
        <View
          className="flex-none border-t px-screen-x pb-6 pt-3"
          style={{ borderColor: 'rgba(255,255,255,.06)', backgroundColor: colors.screenBg }}>
          <View style={{ opacity: ready ? 1 : 0.4 }} pointerEvents={ready ? 'auto' : 'none'}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save"
              accessibilityState={{ disabled: !ready || saving }}
              disabled={!ready || saving}
              onPress={handleSave}
              style={({ pressed }) => [
                { height: 52, shadowColor: colors.accent },
                pressScale({ pressed }),
              ]}
              className="items-center justify-center rounded-button bg-accent shadow-primary-button">
              <Text className="font-archivo text-button font-bold text-white">Save</Text>
            </Pressable>
          </View>
        </View>
      )}
      <Toast message={toast.message} />
    </ScreenBackground>
  );
}

interface PickRowProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/** The prototype's `pick()` row — a checkbox-style multi-select, not the single-select
 * `chips()` control `editProfile`'s sex field uses. */
function PickRow({ label, selected, onPress }: PickRowProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      className="flex-row items-center justify-between rounded-[11px] px-[15px] py-[13px]"
      style={{
        gap: 10,
        backgroundColor: selected ? 'rgba(233,113,47,.1)' : colors.elevated,
        borderWidth: 1,
        borderColor: selected ? 'rgba(233,113,47,.45)' : colors.border,
      }}>
      <Text
        className="font-archivo text-[14px] font-semibold"
        style={{ color: selected ? colors.text : colors.textTertiary }}>
        {label}
      </Text>
      <View
        className="h-5 w-5 items-center justify-center rounded-[10px]"
        style={{
          borderWidth: selected ? 0 : 1.5,
          borderColor: '#37383c',
          backgroundColor: selected ? colors.accent : 'transparent',
        }}>
        {selected && <Icon name="check" size={12} color="#fff" strokeWidth={2.6} />}
      </View>
    </Pressable>
  );
}
