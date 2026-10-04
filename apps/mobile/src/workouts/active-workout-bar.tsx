import { router, useSegments } from 'expo-router';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icon';
import { TIGHT_TEXT_MAX_FONT_SCALE } from '@/theme/text-scale';
import { colors } from '@/theme/tokens';

import { activeWorkout } from './active-workout';
import { formatElapsed } from './format-elapsed';
import { useActiveWorkout } from './use-active-workout';
import { workoutNotice } from './workout-notice';
import { openSetSummary } from './workout-notice-content';

/**
 * The bar for a workout in progress (12B-2b), drawn to the replica the owner approved on 2026-10-04 after the
 * Hevy app's: a card floating above the tab bar with the workout's name and running time, the set it is on, and
 * an x to discard it. Pressing back from the workout leaves it running; this is how it is found again, and
 * tapping it opens the workout.
 *
 * Mounted once, over the router. It stays out of the way on the screens that are the workout itself (`live`,
 * `rest`, `set-timer`) and on the one that ends it (`workout-done`). Geometry, from the replica: 58 tall, inset
 * 12 from each side, radius 16, a 34 px tile and a 34 px discard button, `toastBg` ground with a hairline
 * border; 8 above the tab bar, or 12 above the bottom inset where there is no tab bar.
 *
 * Two departures from the replica, both because the app's own design has no such glyph: the discard button is
 * the app's own delete glyph (the `x` in the destructive colour, as on the exercise screen) rather than a bin,
 * and the paused state's tile uses the clock rather than a pause mark. The "are you sure?" step is the
 * exercise screen's own bottom sheet.
 */
const HIDDEN_ON = new Set(['live', 'rest', 'set-timer', 'workout-done']);
const BAR_HEIGHT = 58;
const SIDE_INSET = 12;
const ABOVE_TAB_BAR = 8;
const ABOVE_BOTTOM_EDGE = 12;
const DISCARD_BG = 'rgba(201,80,60,.1)';

interface BarLine {
  icon: IconName;
  /** The accent for a running workout, a quiet grey while paused. */
  isQuiet: boolean;
  title: string;
  /** The running time, or `Rest`'s countdown, or `Paused`. */
  trailing: string;
  subtitle: string;
}

interface ActiveWorkoutBarProps {
  /** The tab bar's own height, above the bottom inset, so the bar clears it on the tabs. */
  tabBarHeight: number;
}

export function ActiveWorkoutBar({ tabBarHeight }: ActiveWorkoutBarProps) {
  const workout = useActiveWorkout();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => Date.now());
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const [isConfirming, setIsConfirming] = useState(false);
  const isDiscarding = useRef(false);

  const session = workout.session;
  const isVisible =
    session !== null && session.status !== 'completed' && !HIDDEN_ON.has(String(segments[0] ?? ''));

  // Once a second, from the wall clock, like every other clock in the workout.
  useEffect(() => {
    if (!isVisible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isVisible]);

  // A rest starting or ending (from any screen, or the lock screen) changes what the bar says.
  useEffect(() => workoutNotice.subscribeRest(() => refresh()), []);

  if (!isVisible || !session) return null;

  const units = workoutNotice.getUnits();
  const rest = workoutNotice.getRest();
  const isResting = rest !== null && rest.endsAt > now;
  const summary = openSetSummary(session, units);

  const line: BarLine = isResting
    ? {
        icon: 'clock',
        isQuiet: false,
        title: 'Rest',
        trailing: formatElapsed(Math.ceil((rest.endsAt - now) / 1000)),
        subtitle: summary
          ? ['Next', summary.exerciseName, summary.detail].filter(Boolean).join(' · ')
          : 'Next · All sets complete',
      }
    : session.status === 'paused'
      ? {
          icon: 'clock',
          isQuiet: true,
          title: session.name,
          trailing: 'Paused',
          subtitle: summary ? [summary.exerciseName, summary.position].join(' · ') : 'All sets complete',
        }
      : {
          icon: summary ? 'dumb' : 'check',
          isQuiet: false,
          title: session.name,
          trailing: formatElapsed(activeWorkout.elapsedSeconds(now)),
          subtitle: summary
            ? [summary.exerciseName, summary.position, summary.detail].filter(Boolean).join(' · ')
            : 'All sets complete · tap to finish',
        };

  const bottom =
    String(segments[0] ?? '') === '(tabs)'
      ? tabBarHeight + insets.bottom + ABOVE_TAB_BAR
      : insets.bottom + ABOVE_BOTTOM_EDGE;
  const tone = line.isQuiet ? colors.dimmer : colors.accent;

  const discard = () => {
    if (isDiscarding.current) return;
    isDiscarding.current = true;
    setIsConfirming(false);
    void activeWorkout.discard().finally(() => {
      isDiscarding.current = false;
    });
  };

  return (
    <View pointerEvents="box-none" className="absolute inset-0 z-50">
      <View testID="active-workout-bar" style={{ position: 'absolute', left: SIDE_INSET, right: SIDE_INSET, bottom }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to workout"
          onPress={() => router.push('/live')}
          className="flex-row items-center rounded-[16px] pl-[12px] pr-[10px]"
          style={{
            height: BAR_HEIGHT,
            gap: 11,
            backgroundColor: colors.toastBg,
            borderWidth: 1,
            borderColor: colors.border,
          }}>
          <View
            className="h-[34px] w-[34px] items-center justify-center rounded-[10px]"
            style={
              line.isQuiet
                ? { backgroundColor: 'rgba(255,255,255,.05)', borderWidth: 1, borderColor: colors.borderBadge }
                : { backgroundColor: colors.athleteAvatarBg, borderWidth: 1, borderColor: colors.borderAthleteAvatar }
            }>
            <Icon name={line.icon} size={18} color={tone} />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center" style={{ gap: 7 }}>
              <View className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: tone }} />
              <Text
                maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
                numberOfLines={1}
                className="shrink font-archivo text-[13px] font-semibold text-text">
                {line.title}
              </Text>
              <Text
                maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
                className="font-archivo text-[13px] font-bold"
                style={{ color: tone }}>
                {line.trailing}
              </Text>
            </View>
            <Text
              maxFontSizeMultiplier={TIGHT_TEXT_MAX_FONT_SCALE}
              numberOfLines={1}
              className="mt-[3px] font-archivo text-[11.5px]"
              style={{ color: colors.dimmer }}>
              {line.subtitle}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard workout"
            hitSlop={6}
            onPress={() => setIsConfirming(true)}
            className="h-[34px] w-[34px] items-center justify-center rounded-[10px]"
            style={{ backgroundColor: DISCARD_BG }}>
            <Icon name="x" size={18} color={colors.destructive} />
          </Pressable>
        </Pressable>
      </View>

      {isConfirming ? (
        <View className="absolute inset-0 items-end justify-end" style={{ backgroundColor: colors.scrim }}>
          <View
            className="w-full rounded-t-[18px] border-t border-border bg-surface px-[22px] pb-[24px] pt-[20px]"
            style={{ gap: 14 }}>
            <Text className="font-archivo text-[18px] font-bold text-text" style={{ lineHeight: 21.6 }}>
              Discard this workout?
            </Text>
            <Text className="font-archivo text-[13px] text-dimmer" style={{ lineHeight: 19.5 }}>
              Your sets so far will be deleted and nothing will be saved.
            </Text>
            <View className="flex-row" style={{ gap: 9, marginTop: 6 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setIsConfirming(false)}
                className="h-[52px] flex-1 items-center justify-center rounded-button border border-border"
                style={({ pressed }) => (pressed ? { backgroundColor: colors.borderFaint } : null)}>
                <Text className="font-archivo text-[14px] font-bold text-text">Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={discard}
                className="h-[52px] flex-1 items-center justify-center rounded-button bg-destructive">
                <Text className="font-archivo text-[14px] font-bold text-white">Discard</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
