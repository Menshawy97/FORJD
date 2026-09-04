import { MUSCLE_GROUP_DISPLAY_NAMES, type MuscleGroup } from '@forjd/domain';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Header } from '@/components/header';
import { ScreenBackground } from '@/components/screen-background';
import { Toast, useToast } from '@/components/toast';
import { getCachedExercise, openExerciseCatalogueDb } from '@/store/exercise-catalogue';
import { getCompletedSummary, type CompletedSummary } from '@/workouts/live-handoff';
import { formatSessionDuration } from '@/workouts/previous-workout';
import { colors } from '@/theme/tokens';

/**
 * `s_sessionShare()` -- the Share Workout screen, matched against `screenshots/share-card.png`.
 *
 * **Why this exists.** Finishing a workout and tapping share opened `/nutrition-share`, the food
 * cards. That was simply wrong: the design has a separate Share Workout screen, and the two share
 * nothing but a shape.
 *
 * **Three layouts, not the design's six.** The prototype offers Stats Card, Route & Splits, Heart
 * Rate Zones, Personal Record, Muscles Trained and Exercise List. Three of those have no data
 * behind them in this app and are deliberately not shipped rather than filled with plausible
 * numbers:
 *
 * - **Heart Rate Zones** needs a `HealthProvider`, and none feeds this app yet. The prototype
 *   fills its HR from `Math.sin(elapsed/9)`; `workout-done.tsx` already refuses to do the same for
 *   its own Avg/Peak HR tiles, and this screen holds the same line.
 * - **Route & Splits** is a run layout needing GPS tracking, which Phase 3 does not ship.
 * - **Personal Record** needs this session compared against the athlete's history to know whether
 *   one was actually broken. Claiming a PR that did not happen is worse than not offering it.
 *
 * A share card is the one artefact that leaves the app and is seen by other people, which raises
 * rather than lowers the bar on inventing anything on it.
 *
 * **Exercise List needs data only a live summary carries.** A `'history'` summary comes from the
 * session *list* endpoint, which has no per-exercise breakdown, so that layout is offered only
 * when `summary.exercises` is present rather than fetched-for or faked.
 *
 * **Save Image / Instagram / More are mocked**, exactly as `nutrition-share.tsx`'s are and as the
 * prototype's own `flash(...)` calls are. Real capture-and-share was chosen as a follow-up
 * covering *both* share screens together so they cannot diverge -- it needs
 * `react-native-view-shot` and `expo-media-library`, a native-dependency decision worth its own
 * ADR rather than a side effect of this fix.
 */

type LayoutId = 'stats' | 'muscles' | 'exercises';

interface Layout {
  id: LayoutId;
  label: string;
  desc: string;
  /** The prototype's `linear-gradient(160deg, …)` per layout. */
  gradient: [string, string];
}

const LAYOUTS: Layout[] = [
  { id: 'stats', label: 'Stats Card', desc: 'Duration · Volume · Sets', gradient: ['#1D1408', '#101011'] },
  {
    id: 'muscles',
    label: 'Muscles Trained',
    desc: 'Muscle groups hit this session',
    gradient: ['#14161D', '#101011'],
  },
  {
    id: 'exercises',
    label: 'Exercise List',
    desc: 'Every exercise and its sets',
    gradient: ['#101A17', '#101011'],
  },
];

const HEADLINE: Record<LayoutId, string> = {
  stats: 'Workout Complete',
  muscles: 'Muscles Trained',
  exercises: 'Session Breakdown',
};

/** The prototype's own six-row cap on both the muscle chart and the exercise list. */
const MAX_ROWS = 6;

export default function WorkoutShareScreen() {
  const [summary, setSummary] = useState<CompletedSummary | null>(null);
  const [selected, setSelected] = useState<LayoutId>('stats');
  const [muscles, setMuscles] = useState<{ muscle: MuscleGroup; count: number }[]>([]);
  const toast = useToast();

  useEffect(() => {
    setSummary(getCompletedSummary());
  }, []);

  /**
   * Resolved from the on-device catalogue (ADR-022), the same way `workout-done.tsx` does it, so
   * the card works offline and needs no new data.
   */
  useEffect(() => {
    if (!summary) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        const db = await openExerciseCatalogueDb();
        const tally = new Map<MuscleGroup, number>();
        for (const exerciseId of summary.exerciseIds) {
          const cached = await getCachedExercise(db, exerciseId);
          for (const muscle of cached?.primaryMuscles ?? []) {
            tally.set(muscle, (tally.get(muscle) ?? 0) + 1);
          }
        }
        if (cancelled) return;
        setMuscles(
          [...tally.entries()]
            .map(([muscle, count]) => ({ muscle, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, MAX_ROWS),
        );
      } catch {
        // The catalogue being unreadable costs one layout, never the screen.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [summary]);

  const exerciseLines = summary?.exercises ?? [];
  // Offered only when the summary actually carries the lines -- see this file's docblock.
  const layouts = LAYOUTS.filter((layout) => layout.id !== 'exercises' || exerciseLines.length > 0);
  const active = layouts.find((layout) => layout.id === selected) ?? layouts[0]!;

  if (!summary) {
    return (
      <ScreenBackground>
        <Header title="Share Workout" onBack={() => router.back()} />
        <View className="flex-1 items-center justify-center px-screen-x">
          <Text className="text-center font-archivo text-[13px]" style={{ color: '#77776F' }}>
            Finish a workout to share it.
          </Text>
        </View>
      </ScreenBackground>
    );
  }

  const subtitle =
    active.id === 'muscles'
      ? `${summary.exerciseIds.length} exercises · ${summary.completedSetCount} sets`
      : `${summary.name} · ${formatSessionDuration(summary.durationSeconds)}`;

  const maxMuscleCount = muscles[0]?.count ?? 1;

  return (
    <ScreenBackground>
      <Header title="Share Workout" onBack={() => router.back()} />

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        {/* The preview card. Prototype: radius 18, `26px 20px` padding, 4:5 aspect. */}
        <LinearGradient
          accessibilityLabel={`${active.label} preview`}
          colors={active.gradient}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={{
            borderRadius: 18,
            borderWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: 20,
            paddingVertical: 26,
            aspectRatio: 4 / 5,
          }}>
          <Text
            className="font-archivo text-[13px] font-extrabold tracking-[.06em]"
            style={{ color: colors.accent }}>
            FORJD
          </Text>

          <View className="mt-auto">
            <Text className="font-archivo text-[22px] font-bold" style={{ color: colors.text }}>
              {HEADLINE[active.id]}
            </Text>
            <Text
              className="mt-[2px] font-archivo text-[12px] font-medium"
              style={{ color: '#8B8B83' }}>
              {subtitle}
            </Text>

            {active.id === 'stats' ? (
              <View className="mt-[6px] flex-row" style={{ gap: 18 }}>
                {[
                  ['Volume', `${Math.round(summary.volumeKg).toLocaleString()} kg`],
                  ['Sets', String(summary.completedSetCount)],
                ].map(([label, value]) => (
                  <View key={label}>
                    <Text
                      className="font-archivo text-[17px] font-bold"
                      style={{ color: colors.text }}>
                      {value}
                    </Text>
                    <Text
                      className="mt-[4px] font-archivo text-[10px] font-medium"
                      style={{ color: '#77776F' }}>
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {active.id === 'muscles' ? (
              <View className="mt-[6px]" style={{ gap: 9 }}>
                {muscles.map(({ muscle, count }) => (
                  <View key={muscle} className="flex-row items-center" style={{ gap: 10 }}>
                    <Text
                      className="font-archivo text-[12px] font-semibold"
                      style={{ width: 82, color: '#D8D8D0' }}>
                      {MUSCLE_GROUP_DISPLAY_NAMES[muscle]}
                    </Text>
                    <View
                      className="h-[7px] flex-1 overflow-hidden rounded-[4px]"
                      style={{ backgroundColor: 'rgba(255,255,255,.08)' }}>
                      <View
                        className="h-[7px] rounded-[4px]"
                        style={{
                          width: `${Math.round((count / maxMuscleCount) * 100)}%`,
                          backgroundColor: colors.accent,
                        }}
                      />
                    </View>
                    <Text
                      className="text-right font-archivo text-[11.5px] font-semibold"
                      style={{ width: 44, color: '#8B8B83' }}>
                      {`${count} sets`}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {active.id === 'exercises' ? (
              <View className="mt-[6px]" style={{ gap: 9 }}>
                {exerciseLines.slice(0, MAX_ROWS).map((line) => (
                  <View key={line.exerciseId} className="flex-row items-center" style={{ gap: 10 }}>
                    <Text
                      numberOfLines={1}
                      className="flex-1 font-archivo text-[13px] font-semibold"
                      style={{ color: colors.text }}>
                      {line.name}
                    </Text>
                    <Text
                      className="font-archivo text-[12px] font-semibold"
                      style={{ color: colors.accent }}>
                      {`${line.setCount} × ${line.detail}`}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </LinearGradient>

        <Text
          className="mb-[10px] mt-[22px] font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]"
          style={{ color: '#77776F' }}>
          Choose a layout
        </Text>

        {/* Horizontal strip. Only the selected thumbnail gets the 2px accent border. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 10 }}>
          {layouts.map((layout) => {
            const isSelected = layout.id === active.id;
            return (
              <Pressable
                key={layout.id}
                accessibilityRole="button"
                accessibilityLabel={`Use the ${layout.label} layout`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelected(layout.id)}
                style={{ width: 100 }}>
                <LinearGradient
                  colors={layout.gradient}
                  start={{ x: 0.15, y: 0 }}
                  end={{ x: 0.85, y: 1 }}
                  style={{
                    width: 100,
                    height: 125,
                    borderRadius: 12,
                    borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? colors.accent : colors.border,
                  }}
                />
                <Text
                  className="mt-[7px] font-archivo text-[11.5px] font-semibold"
                  style={{ color: isSelected ? colors.accent : colors.text }}>
                  {layout.label}
                </Text>
                <Text className="mt-[3px] font-archivo text-[10px]" style={{ color: '#6E6E66' }}>
                  {layout.desc}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View className="mt-[24px]" style={{ gap: 10 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save Image"
            onPress={() => toast.show('Image saved to Photos')}
            className="h-[48px] items-center justify-center rounded-[11px]"
            style={{ backgroundColor: colors.accent }}>
            <Text className="font-archivo text-[14px] font-bold text-white">Save Image</Text>
          </Pressable>

          <View className="flex-row" style={{ gap: 10 }}>
            {['Instagram', 'More'].map((label) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => toast.show(`Sharing to ${label}…`)}
                className="h-[48px] flex-1 items-center justify-center rounded-[11px]"
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}>
                <Text
                  className="font-archivo text-[12.5px] font-semibold"
                  style={{ color: colors.text }}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      <Toast message={toast.message} />
    </ScreenBackground>
  );
}
