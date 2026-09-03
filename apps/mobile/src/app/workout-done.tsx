import { MUSCLE_GROUP_DISPLAY_NAMES, type MuscleGroup } from '@forjd/domain';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { getCachedExercise, openExerciseCatalogueDb } from '@/store/exercise-catalogue';
import { clearCompletedSummary, getCompletedSummary } from '@/workouts/live-handoff';
import { syncPendingSessions } from '@/workouts/sync-sessions';
import { colors } from '@/theme/tokens';

/**
 * `s_done()`, matched against `screenshots/workout done.png` -- the screen a workout ends on
 * (Phase 3I).
 *
 * The session itself is already handed to the sync queue by the time this renders: the live
 * screen enqueues on Finish, so nothing here is load-bearing for the athlete's data. This is a
 * read-only report, which is why it receives the *computed* figures rather than the session --
 * a future edit here cannot write back into a workout already queued for upload.
 *
 * **Three of the design's six stat tiles ship as honest empty states**: Avg HR, Peak HR and
 * Calories, along with the HR-through-the-session chart. The prototype fills them from a
 * simulated heart rate (`Math.sin(elapsed/9)`), and no `HealthProvider` feeds this app yet.
 * Phase J settled that showing invented numbers as a user's own training data is not
 * acceptable; the tiles keep their place in the layout and read an em dash.
 *
 * **Muscles worked is real**, not invented: it counts each exercise against its primary muscles
 * by resolving it in the on-device catalogue (ADR-022), so it works offline and needs no new
 * data.
 */

/** `0:01`, `12:30`, `1:02:11` -- the prototype's own `fmt`. */
function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  color?: string;
}

/** The prototype's `stat()` helper: `13px 14px` card, 9px gap under the label, 25px figure. */
function StatTile({ label, value, unit, color }: StatTileProps) {
  return (
    <View
      className="flex-1 rounded-card px-[14px] py-[13px]"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Text className="font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]" style={{ color: '#77776F' }}>
        {label}
      </Text>
      <View className="mt-[9px] flex-row items-baseline" style={{ gap: 4 }}>
        <Text
          className="font-archivo text-[25px] font-bold tracking-[-.02em]"
          style={{ color: color ?? colors.text }}
          numberOfLines={1}>
          {value}
        </Text>
        {unit ? (
          <Text className="font-archivo text-[11.5px] font-medium" style={{ color: '#6E6E66' }}>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

interface MuscleRow {
  muscle: MuscleGroup;
  sets: number;
}

export default function WorkoutDoneScreen() {
  const summary = getCompletedSummary();
  const [muscles, setMuscles] = useState<MuscleRow[]>([]);

  /**
   * Try to upload straight away, while the athlete is still looking at the summary — the most
   * likely moment for the session to be online, and the point at which "will sync when you are
   * back online" is most worth making true. Not awaited and not surfaced: the queue is durable
   * and the app-foreground trigger picks up anything this misses.
   */
  useEffect(() => {
    if (!summary) return;
    void syncPendingSessions();
  }, [summary]);

  useEffect(() => {
    if (!summary) return;
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
        setMuscles([...tally.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets));
      } catch {
        // The catalogue being unavailable costs this one section, not the whole screen.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [summary]);

  if (!summary) {
    return (
      <ScreenBackground>
        <View className="flex-1 items-center justify-center px-screen-x">
          <Text className="font-archivo text-[13px] text-dimmer">No workout to summarise.</Text>
        </View>
        <TabBar active="train" />
      </ScreenBackground>
    );
  }

  const maxSets = muscles.reduce((most, row) => Math.max(most, row.sets), 0);

  return (
    <ScreenBackground>
      <ScrollView className="flex-1 px-screen-x" showsVerticalScrollIndicator={false}>
        <View className="mt-[14px] flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={() => {
              // Cleared on the way out, so a finished workout is never shown a second time.
              clearCompletedSummary();
              router.replace('/(tabs)/train');
            }}
            className="h-[52px] w-[52px] items-center justify-center rounded-[14px]"
            style={{ backgroundColor: 'rgba(121,185,138,.13)' }}>
            <Icon name="check" size={26} color={colors.green} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share workout"
            onPress={() => router.push('/nutrition-share')}
            className="h-[44px] w-[44px] items-center justify-center rounded-[13px]"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
            <Icon name="share" size={19} color="#C8C8C0" />
          </Pressable>
        </View>

        <Text className="mt-[18px] font-archivo text-[28px] font-bold tracking-[-.025em] text-text">
          Session complete
        </Text>
        <Text className="mb-[20px] mt-[10px] font-archivo text-[13.5px]" style={{ color: '#9A9A92' }}>
          {`${summary.name} · logged offline, will sync when you are back online.`}
        </Text>

        <View className="flex-row" style={{ gap: 8 }}>
          <StatTile label="Duration" value={formatDuration(summary.durationSeconds)} />
          <StatTile label="Volume" value={summary.volumeKg.toLocaleString()} unit="kg" />
          <StatTile label="Sets" value={String(summary.completedSetCount)} />
        </View>

        {/*
          Heart rate and calories keep their tiles but not their numbers. The prototype's are
          simulated; no HealthProvider feeds this app yet, and inventing an athlete's own
          training data was rejected in Phase J.
        */}
        <View className="mt-[8px] flex-row" style={{ gap: 8 }}>
          <StatTile label="Avg HR" value="—" unit="bpm" color="#6E6E66" />
          <StatTile label="Peak HR" value="—" unit="bpm" color="#6E6E66" />
          <StatTile label="Calories" value="—" unit="kcal" color="#6E6E66" />
        </View>

        <View
          className="mt-[12px] rounded-card px-[16px] py-[15px]"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Text
            className="font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]"
            style={{ color: '#77776F' }}>
            HR through the session
          </Text>
          <Text className="mt-[12px] font-archivo text-[12px]" style={{ color: '#6E6E66' }}>
            Connect a watch to see your heart rate here.
          </Text>
        </View>

        {muscles.length > 0 ? (
          <View className="mt-[20px]">
            <Text
              className="font-archivo text-[9.5px] font-semibold uppercase tracking-[.14em]"
              style={{ color: '#77776F' }}>
              Muscles worked
            </Text>
            <View
              className="mt-[10px] rounded-card px-[15px] py-[4px]"
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              {muscles.map((row, index) => (
                <View
                  key={row.muscle}
                  className="flex-row items-center py-[11px]"
                  style={
                    index < muscles.length - 1
                      ? { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,.05)', gap: 11 }
                      : { gap: 11 }
                  }>
                  <Text className="w-[86px] font-archivo text-[12.5px] font-semibold text-text" numberOfLines={1}>
                    {MUSCLE_GROUP_DISPLAY_NAMES[row.muscle]}
                  </Text>
                  <View className="h-[6px] flex-1 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#232427' }}>
                    <View
                      className="h-[6px] rounded-[3px]"
                      style={{
                        width: `${maxSets === 0 ? 0 : (row.sets / maxSets) * 100}%`,
                        backgroundColor: colors.accent,
                      }}
                    />
                  </View>
                  <Text className="font-archivo text-[11px] font-medium" style={{ color: '#6E6E66' }}>
                    {`${row.sets} ${row.sets === 1 ? 'set' : 'sets'}`}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ height: 26 }} />
      </ScrollView>

      <TabBar active="train" />
    </ScreenBackground>
  );
}
