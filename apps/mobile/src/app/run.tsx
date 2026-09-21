import { useKeepAwake } from 'expo-keep-awake';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { pressGhost, pressScale } from '@/components/press-feedback';
import { ScreenBackground } from '@/components/screen-background';
import { Toast } from '@/components/toast';
import { GpsPill } from '@/features/run/gps-pill';
import { RunHeartRateCard } from '@/features/run/run-heart-rate-card';
import { RunMetricTile } from '@/features/run/run-metric-tile';
import { formatDistanceKm, formatDuration, formatPace, formatSpeedKmh } from '@/features/run/run-format';
import { RunSplits } from '@/features/run/run-splits';
import { useRunSession, type RunPermission } from '@/features/run/use-run-session';
import { RouteMap } from '@/integrations/maps/route-map';
import { colors } from '@/theme/tokens';

/**
 * `s_run()`, matched against `screenshots/live run 1.png` and `live run 2.png` (R6): the screen a
 * run is followed on. Everything it does is in `useRunSession`; this is the picture of it.
 *
 * Layout, from the prototype: a header (`0 22px 12px`) with a 7px pulse dot, `600 10px` label at
 * `.14em` and a 20px close; a map (`margin 0 22px`, height 206) with the GPS pill; a scroll area
 * (`0 22px 26px`) holding the `700 46px` elapsed time, the 2x2 metric grid (gap 8), the heart-rate
 * card and the splits; and a footer (`12px 22px 24px`, top rule, gap 9) of two 52px buttons.
 *
 * Deviations, recorded in `docs/product/live-run-plan.md`: the close asks before discarding (the
 * prototype's instant exit would silently lose a run); the pulse animation is a static dot, as on the
 * strength runner; and a denied or approximate location shows an explanation where the map would be.
 */
const MAP_HEIGHT = 206;

type NoticePermission = Exclude<RunPermission, 'checking' | 'granted'>;

const PERMISSION_NOTICES: Record<NoticePermission, { title: string; body: string; canOpenSettings: boolean }> = {
  denied: {
    title: 'Location is off for FORJD',
    body: 'A run needs your precise location to measure distance and pace. Turn it on in Settings to track this run.',
    canOpenSettings: true,
  },
  coarse_only: {
    title: 'Precise location is needed',
    body: 'FORJD can only see your approximate location. Choose "Precise" in Settings so a run can measure distance.',
    canOpenSettings: true,
  },
  unavailable: {
    title: 'Location is not available',
    body: 'This phone cannot give FORJD a location right now, so this run cannot measure distance.',
    canOpenSettings: false,
  },
};

function PermissionNotice({ permission }: { permission: NoticePermission }) {
  const notice = PERMISSION_NOTICES[permission];
  return (
    <View
      className="rounded-card px-[15px] py-[14px]"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Text className="font-archivo text-[14px] font-bold text-text">{notice.title}</Text>
      <Text className="mt-[6px] font-archivo text-[12.5px] leading-[18px]" style={{ color: colors.dim }}>
        {notice.body}
      </Text>
      {notice.canOpenSettings ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Settings"
          onPress={() => void Linking.openSettings()}
          style={pressScale}
          className="mt-[12px] h-[44px] items-center justify-center rounded-[10px] bg-accentDark">
          <Text className="font-archivo text-[13px] font-bold text-white">Open Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const asNotice = (permission: RunPermission): NoticePermission | null =>
  permission === 'denied' || permission === 'coarse_only' || permission === 'unavailable' ? permission : null;

export default function RunScreen() {
  useKeepAwake();
  const session = useRunSession();
  const { stats } = session;
  const isPaused = session.status === 'paused';
  const noticePermission = asNotice(session.permission);

  return (
    <ScreenBackground>
      <View className="flex-none flex-row items-center justify-between px-screen-x pb-[12px]">
        <View className="flex-row items-center" style={{ gap: 7 }}>
          <View
            className="h-[7px] w-[7px] rounded-[4px]"
            style={{ backgroundColor: isPaused ? colors.metadata : colors.accent }}
          />
          <Text
            className="font-archivo text-[10px] font-semibold uppercase tracking-[.14em]"
            style={{ color: isPaused ? colors.metadata : colors.accent }}>
            {`${isPaused ? 'Paused' : 'Live'} · Outdoor run`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard run"
          hitSlop={12}
          disabled={session.isFinishing}
          onPress={session.confirmDiscard}
          style={{ opacity: 0.6 }}>
          <Icon name="x" size={20} color="#C8C8C0" />
        </Pressable>
      </View>

      <View className="flex-none px-screen-x">
        {noticePermission ? (
          <PermissionNotice permission={noticePermission} />
        ) : (
          <View>
            <RouteMap
              points={stats?.route ?? []}
              height={MAP_HEIGHT}
              caption="live map · route + km markers"
              accessibilityLabel="Map of your run so far"
            />
            <GpsPill quality={session.quality} />
          </View>
        )}
        {session.autoPaused ? (
          <Text className="mt-[10px] font-archivo text-[12px]" style={{ color: colors.dim }}>
            Paused when the phone locked. Tap Resume to carry on.
          </Text>
        ) : null}
      </View>

      <ScrollView
        className="flex-1 px-screen-x"
        contentContainerStyle={{ paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}>
        <View className="items-center pb-[4px] pt-[18px]">
          <Text
            className="font-archivo text-[46px] font-bold tracking-[-.03em] text-text"
            style={{ lineHeight: 46, fontVariant: ['tabular-nums'] }}>
            {formatDuration(stats?.movingSeconds ?? 0)}
          </Text>
          <Text className="mt-[8px] font-archivo text-[11.5px] font-medium" style={{ color: colors.dimmer }}>
            elapsed
          </Text>
        </View>

        <View className="mt-[16px]" style={{ gap: 8 }}>
          <View className="flex-row" style={{ gap: 8 }}>
            <RunMetricTile label="Distance" value={formatDistanceKm(stats?.distanceMeters ?? 0)} unit="km" />
            <RunMetricTile
              label="Avg pace"
              value={formatPace(stats?.averagePaceSecondsPerKm ?? null)}
              unit="/km"
              color={colors.accent}
            />
          </View>
          <View className="flex-row" style={{ gap: 8 }}>
            <RunMetricTile
              label="Current speed"
              value={formatSpeedKmh(stats?.currentSpeedMetersPerSecond ?? null)}
              unit="km/h"
            />
            <RunMetricTile
              label="Avg HR"
              value={session.heartRate.averageBpm === null ? '—' : String(session.heartRate.averageBpm)}
              unit="bpm"
              color={colors.destructive}
            />
          </View>
        </View>

        <RunHeartRateCard currentBpm={session.heartRate.currentBpm} series={session.heartRate.series} />
        <RunSplits splits={session.splits} />
      </ScrollView>

      <View
        className="flex-none flex-row px-screen-x pb-[24px] pt-[12px]"
        style={{ gap: 9, borderTopWidth: 1, borderTopColor: colors.borderCell }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPaused ? 'Resume run' : 'Pause run'}
          onPress={isPaused ? session.resume : session.pause}
          style={pressGhost}
          // The paused state's outline is the accent, the prototype's `'1px solid '+O`. In the class
          // rather than a style callback, so the border is laid out with the rest of the box.
          className={`h-[52px] flex-1 items-center justify-center rounded-button border ${
            isPaused ? 'border-accent' : 'border-border'
          }`}>
          <Text className="font-archivo text-[14px] font-semibold" style={{ color: isPaused ? colors.accent : colors.dim }}>
            {isPaused ? 'Resume run' : 'Pause'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Finish run"
          accessibilityState={{ disabled: session.isFinishing }}
          disabled={session.isFinishing}
          onPress={session.finish}
          style={pressScale}
          className="h-[52px] flex-1 items-center justify-center rounded-button bg-accentDark shadow-primary-button">
          <Text className="font-archivo text-button font-bold tracking-[.01em] text-white">Finish run</Text>
        </Pressable>
      </View>

      <Toast message={session.toast.message} />
    </ScreenBackground>
  );
}
