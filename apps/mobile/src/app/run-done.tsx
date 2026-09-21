import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { pressGhost } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { TabBar } from '@/components/tab-bar';
import { Toast, useToast } from '@/components/toast';
import { formatDistanceKm, formatDuration, formatPace } from '@/features/run/run-format';
import { RunSplits } from '@/features/run/run-splits';
import { RunStatTile } from '@/features/run/run-stat-tile';
import { RouteMap } from '@/integrations/maps/route-map';
import { colors } from '@/theme/tokens';
import { clearCompletedRun, getCompletedRun } from '@/workouts/run-handoff';

/**
 * `s_runDone()`, matched against `screenshots/run done.png` (R7): the screen a run ends on.
 *
 * The run is already in the sync queue by the time this renders (the live run enqueues on Finish), so
 * this is a read-only report of computed figures. Layout from the prototype: a 52px check tile
 * (`rgba(121,185,138,.13)`, radius 14) and a 44px share tile (radius 13); a `700 28px/1.12`
 * "Run complete" 18px below; a `400 13.5px/1.45` subtitle; the route map (height 180); two rows of
 * three stat tiles (gap 8, rows 12 and 8 apart); the splits; a ghost "View Progress" 22px below; and
 * the tab bar with Train active.
 *
 * Deviations, recorded in `docs/product/live-run-plan.md`: the share tile says sharing is coming soon
 * (the run share card is not part of this work); calories say "estimated" when they are the app's
 * arithmetic and not a watch reading; and a figure that was never measured reads a dash, where the
 * prototype hard-codes 150 bpm, 298 kcal and 24 m.
 */
const MAP_HEIGHT = 180;
const DASH = '—';

export default function RunDoneScreen() {
  const run = getCompletedRun();
  const toast = useToast();

  if (!run) {
    return (
      <ScreenBackground>
        <View className="flex-1 items-center justify-center px-screen-x">
          <Text className="font-archivo text-[13px] text-dimmer">No run to summarise.</Text>
        </View>
        <TabBar active="train" />
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView className="flex-1 px-screen-x" showsVerticalScrollIndicator={false}>
        <View className="mt-[14px] flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={() => {
              // Cleared on the way out, so a finished run is never shown a second time.
              clearCompletedRun();
              router.replace('/(tabs)/train');
            }}
            className="h-[52px] w-[52px] items-center justify-center rounded-[14px]"
            style={{ backgroundColor: 'rgba(121,185,138,.13)' }}>
            <Icon name="check" size={26} color={colors.green} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share run"
            onPress={() => toast.show('Sharing a run is coming soon')}
            className="h-[44px] w-[44px] items-center justify-center rounded-[13px]"
            style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
            <Icon name="share" size={19} color="#C8C8C0" />
          </Pressable>
        </View>

        <Text
          className="mt-[18px] font-archivo text-[28px] font-bold tracking-[-.025em] text-text"
          style={{ lineHeight: 31.36 }}>
          Run complete
        </Text>
        <Text className="mb-[20px] mt-[10px] font-archivo text-[13.5px] leading-[19.575px]" style={{ color: colors.dim }}>
          Outdoor run · logged offline, will sync when you are back online.
        </Text>

        <RouteMap
          points={run.route}
          height={MAP_HEIGHT}
          caption="route + km markers"
          accessibilityLabel={`Map of your run, ${formatDistanceKm(run.distanceMeters)} kilometres`}
        />

        <View className="mt-[12px] flex-row" style={{ gap: 8 }}>
          <RunStatTile label="Distance" value={formatDistanceKm(run.distanceMeters)} unit="km" />
          <RunStatTile label="Duration" value={formatDuration(run.movingSeconds)} />
          <RunStatTile
            label="Avg pace"
            value={formatPace(run.averagePaceSecondsPerKm)}
            unit="/km"
            color={colors.accent}
          />
        </View>
        <View className="mt-[8px] flex-row" style={{ gap: 8 }}>
          <RunStatTile
            label="Avg HR"
            value={run.avgHeartRateBpm === null ? DASH : String(run.avgHeartRateBpm)}
            unit="bpm"
            color={colors.destructive}
          />
          <RunStatTile
            label="Calories"
            value={run.caloriesKcal === null ? DASH : String(run.caloriesKcal)}
            unit="kcal"
            sub={run.caloriesSource === 'estimate' ? 'estimated' : undefined}
          />
          <RunStatTile
            label="Elevation"
            value={run.elevationGainMeters === null ? DASH : String(Math.round(run.elevationGainMeters))}
            unit="m"
          />
        </View>

        <RunSplits splits={run.splits} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View Progress"
          onPress={() => router.replace('/(tabs)/progress')}
          style={pressGhost}
          className="mt-[22px] h-[52px] items-center justify-center rounded-button border border-border">
          <Text className="font-archivo text-button font-semibold" style={{ color: colors.dim }}>
            View Progress
          </Text>
        </Pressable>

        <View style={{ height: 26 }} />
      </ScrollView>

      <Toast message={toast.message} />
      <TabBar active="train" />
    </ScreenBackground>
  );
}
