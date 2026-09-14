import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { colors } from '@/theme/tokens';

import type { SessionStats } from '@/workouts/live-session';

/**
 * The live workout screen's fixed (non-scrolling) header -- extracted from `app/live.tsx`
 * (R23a) with its geometry unchanged: `padding:'0 22px 14px'`, the live/paused status line,
 * the elapsed clock with its cancel/pause/finish controls, the progress bar, the Watch card,
 * and the "not saving" / "session resumed" banners.
 *
 * Presentational only. Every figure it shows is derived by the caller (`sessionStats`,
 * `formatElapsed`) -- this file owns layout, not arithmetic, matching the
 * `previous-workout-card.tsx` split already established in this directory.
 */
interface LiveSessionHeaderProps {
  sessionName: string;
  isPaused: boolean;
  /** Already formatted, e.g. `12:30` or `1:02:11` -- see `formatElapsed` in `app/live.tsx`. */
  elapsedLabel: string;
  stats: SessionStats;
  /** False once a log write has failed -- surfaced here so it is never a silent loss. */
  isLogging: boolean;
  /** True when this screen picked a session back up after a crash rather than starting one. */
  resumed: boolean;
  onCancel: () => void;
  onPauseResume: () => void;
  onFinish: () => void;
}

export function LiveSessionHeader({
  sessionName,
  isPaused,
  elapsedLabel,
  stats,
  isLogging,
  resumed,
  onCancel,
  onPauseResume,
  onFinish,
}: LiveSessionHeaderProps) {
  return (
    <View className="flex-none px-screen-x pb-[14px]">
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <View className="h-[7px] w-[7px] rounded-[4px]" style={{ backgroundColor: colors.accent }} />
        <Text
          numberOfLines={1}
          className="flex-1 font-archivo text-[10px] font-semibold uppercase tracking-[.14em] text-accent">
          {`${isPaused ? 'Paused' : 'Live'} · ${sessionName}`}
        </Text>
      </View>

      <View className="mt-[10px] flex-row items-center justify-between" style={{ gap: 8 }}>
        {/* `font:'700 28px/1 Archivo', letterSpacing:'-.02em'` */}
        <Text className="font-archivo text-[28px] font-bold tracking-[-.02em] text-text">{elapsedLabel}</Text>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel workout"
            onPress={onCancel}
            className="h-[44px] w-[44px] items-center justify-center rounded-[12px]"
            style={{ backgroundColor: 'rgba(255,255,255,.06)' }}>
            <Icon name="x" size={15} color="#C9503C" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPaused ? 'Resume workout' : 'Pause workout'}
            onPress={onPauseResume}
            className="h-[44px] items-center justify-center rounded-[12px] px-[14px]"
            style={{ backgroundColor: 'rgba(255,255,255,.06)' }}>
            <Text className="font-archivo text-[12px] font-bold text-text">{isPaused ? 'Resume' : 'Pause'}</Text>
          </Pressable>
          {/* Deliberately 34px tall, not 44 -- the prototype's own asymmetry. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Finish workout"
            onPress={onFinish}
            className="h-[34px] items-center justify-center rounded-[10px] px-[14px]"
            style={{ backgroundColor: colors.accent }}>
            <Text className="font-archivo text-[12px] font-bold text-white">Finish</Text>
          </Pressable>
        </View>
      </View>

      <View className="mt-[14px] flex-row items-center" style={{ gap: 10 }}>
        <View className="h-[3px] flex-1 overflow-hidden rounded-[2px]" style={{ backgroundColor: '#232427' }}>
          <View
            accessibilityLabel="Workout progress"
            className="h-[3px]"
            style={{ width: `${stats.progress * 100}%`, backgroundColor: colors.accent }}
          />
        </View>
        <Text className="font-archivo text-[11px] font-semibold" style={{ color: '#9A9A92' }}>
          {`${stats.completedSetCount}/${stats.totalSetCount} sets`}
        </Text>
        <Text className="font-archivo text-[11px] font-semibold" style={{ color: '#6E6E66' }}>
          {`${stats.volumeKg.toLocaleString()} kg`}
        </Text>
      </View>

      {/*
        Watch card. Container matched exactly (`#141517`, radius 11, `10px 13px`, gap 9), but
        it ships an HONEST EMPTY STATE where the prototype shows `145 bpm / 142 avg`: those
        numbers are simulated (`Math.sin(elapsed/9)`) and no `HealthProvider` feeds this
        screen yet. Phase J established that invented numbers shown as a user's own training
        data are not acceptable, so the layout renders with a "not connected" line instead.
      */}
      <View
        className="mt-[12px] flex-row items-center rounded-[11px] px-[13px] py-[10px]"
        style={{ backgroundColor: '#141517', borderWidth: 1, borderColor: colors.border, gap: 9 }}>
        <View className="h-[8px] w-[8px] rounded-[5px]" style={{ backgroundColor: '#6E6E66' }} />
        <Text
          className="font-archivo text-[9.5px] font-semibold uppercase tracking-[.12em]"
          style={{ color: '#77776F' }}>
          Watch
        </Text>
        <View className="flex-1" />
        <Text className="font-archivo text-[10.5px] font-medium" style={{ color: '#6E6E66' }}>
          No watch connected
        </Text>
      </View>

      {isLogging ? null : (
        <Text
          accessibilityLiveRegion="assertive"
          className="mt-[8px] font-archivo text-[11px] font-semibold"
          style={{ color: colors.errorText }}>
          Not saving — this session may be lost if the app closes
        </Text>
      )}

      {/* Says plainly that nothing was lost, rather than leaving the athlete to work it out. */}
      {resumed ? (
        <Text className="mt-[8px] font-archivo text-[11px] font-semibold" style={{ color: colors.green }}>
          Session resumed — your logged sets were recovered
        </Text>
      ) : null}
    </View>
  );
}
