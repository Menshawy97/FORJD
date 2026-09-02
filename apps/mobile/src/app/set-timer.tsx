import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ScreenBackground } from '@/components/screen-background';
import { CountdownRing } from '@/workouts/countdown-ring';
import { getTimerContext, setCompletedTimedSet } from '@/workouts/live-handoff';
import { colors } from '@/theme/tokens';

/**
 * `s_setTimer()` (`FORJD Mobile.dc.html` ~line 3121). Like the rest screen, **no screenshot
 * exists** for this one, so the prototype's own function is authoritative: the same 200 px
 * ring, a `hold the position` / `paused` caption, the "Current set" block reading
 * `Set N · X s target`, symmetric `−15` / `+15` adjusters (unlike rest's asymmetric pair), and
 * two CTAs -- ghost Pause/Resume beside a solid `Complete set`.
 *
 * **This screen cannot tick the set itself.** It runs on its own route, so the live session's
 * state is not in scope here. Reaching zero -- or tapping `Complete set` -- records which set
 * finished in `live-handoff`'s return slot and navigates back; the live screen consumes that
 * on focus and puts the tick through the reducer, so exactly one code path ever completes a
 * set and the event log stays the single source of truth.
 *
 * The countdown is wall-clock based for the same reason the rest screen's is: a backgrounded
 * app's interval is throttled, and a plank timed by counting ticks would over-run.
 */
export default function SetTimerScreen() {
  const params = useLocalSearchParams<{ exercise?: string; set?: string; seconds?: string }>();
  const context = getTimerContext();

  const exerciseIndex = Number(params.exercise ?? context?.exerciseIndex ?? 0) || 0;
  const setIndex = Number(params.set ?? context?.setIndex ?? 0) || 0;
  const targetSeconds = Number(params.seconds ?? context?.seconds ?? 45) || 45;
  const exerciseName = context?.exerciseName ?? 'Timed set';

  const [totalSeconds, setTotalSeconds] = useState(targetSeconds);
  const [endsAt, setEndsAt] = useState(() => Date.now() + targetSeconds * 1000);
  const [remaining, setRemaining] = useState(targetSeconds);
  const [isPaused, setIsPaused] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const complete = useCallback(() => {
    if (isDone) return;
    setIsDone(true);
    setCompletedTimedSet({ exerciseIndex, setIndex });
    router.back();
  }, [exerciseIndex, isDone, setIndex]);

  useEffect(() => {
    if (isPaused || isDone) return;
    const tick = () => setRemaining((endsAt - Date.now()) / 1000);
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt, isPaused, isDone]);

  useEffect(() => {
    if (isPaused || isDone || remaining > 0) return;
    complete();
  }, [complete, isPaused, isDone, remaining]);

  const togglePause = () => {
    if (isPaused) {
      // Resuming re-anchors the end time to whatever was left, so paused time is not counted.
      setEndsAt(Date.now() + Math.max(0, remaining) * 1000);
      setIsPaused(false);
      return;
    }
    setIsPaused(true);
  };

  const adjust = (delta: number) => {
    const next = Math.max(1, remaining + delta);
    setRemaining(next);
    setTotalSeconds((current) => Math.max(current, next));
    if (!isPaused) setEndsAt(Date.now() + next * 1000);
  };

  return (
    <ScreenBackground>
      <View className="flex-1 px-screen-x pb-[26px]">
        <View className="flex-row items-center justify-between">
          <Text className="font-archivo text-[10px] font-semibold uppercase tracking-[.14em] text-accent">
            Timed set
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close timer"
            onPress={() => router.back()}
            hitSlop={10}>
            <Icon name="x" size={18} color={colors.dim} />
          </Pressable>
        </View>

        <View className="flex-1 items-center justify-center" style={{ gap: 26 }}>
          <CountdownRing
            progress={totalSeconds > 0 ? Math.max(0, remaining) / totalSeconds : 0}
            label={String(Math.max(0, Math.ceil(remaining)))}
            caption={isPaused ? 'paused' : 'hold the position'}
          />

          <View className="items-center">
            <Text className="font-archivo text-[10px] font-semibold uppercase tracking-[.14em] text-label">
              Current set
            </Text>
            <Text className="mt-[9px] font-archivo text-[19px] font-bold text-text">{exerciseName}</Text>
            <Text className="mt-[8px] font-archivo text-[13px] font-medium text-accent">
              {`Set ${setIndex + 1} · ${targetSeconds} s target`}
            </Text>
          </View>

          <View className="flex-row" style={{ gap: 9 }}>
            {(
              [
                ['−15', -15],
                ['+15', 15],
              ] as const
            ).map(([label, delta]) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={delta < 0 ? 'Shorten set by 15 seconds' : 'Extend set by 15 seconds'}
                onPress={() => adjust(delta)}
                className="rounded-[10px] px-[20px] py-[11px]"
                style={{ backgroundColor: '#1A1B1D', borderWidth: 1, borderColor: colors.border }}>
                <Text className="font-archivo text-[13px] font-semibold text-text">{`${label}s`}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View className="flex-row" style={{ gap: 9 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPaused ? 'Resume set' : 'Pause set'}
            onPress={togglePause}
            className="h-[52px] flex-1 items-center justify-center rounded-[12px]"
            style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text className="font-archivo text-[14px] font-semibold text-dim">{isPaused ? 'Resume' : 'Pause'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Complete set"
            onPress={complete}
            className="h-[52px] flex-1 items-center justify-center rounded-[12px]"
            style={{ backgroundColor: colors.accent }}>
            <Text className="font-archivo text-[14.5px] font-bold text-white">Complete set</Text>
          </Pressable>
        </View>
      </View>
    </ScreenBackground>
  );
}
