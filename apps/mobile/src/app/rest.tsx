import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ScreenBackground } from '@/components/screen-background';
import { CountdownRing } from '@/workouts/countdown-ring';
import { getRestContext } from '@/workouts/live-handoff';
import { cancelRestEndNotification, scheduleRestEndNotification } from '@/workouts/rest-notifications';
import { colors } from '@/theme/tokens';

/**
 * `s_rest()` (`FORJD Mobile.dc.html` ~line 2067). **No rest screenshot exists** -- the
 * screenshots folder has `live workout.png` / `live workout 2.png` but nothing for rest -- so
 * under the standing precedence order the prototype's own function is authoritative here, and
 * it is matched element for element: the 200 px ring, the `until next set` caption, the
 * "Up next" block, the `−15s` / `+30s` adjusters (deliberately asymmetric, as the prototype
 * has them) and a ghost `Skip Rest`.
 *
 * The countdown is **wall-clock based**, not a decrementing counter: `setInterval` in a
 * backgrounded app is throttled or suspended, so counting ticks would drift and a phone locked
 * for the whole rest period would come back showing almost the full ninety seconds left. The
 * remaining time is recomputed from an end timestamp on every tick instead, which is correct
 * however long the app was away. (Slice H4 adds the notification that fires while it is away.)
 */
function formatSeconds(total: number): string {
  const safe = Math.max(0, Math.ceil(total));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export default function RestScreen() {
  const params = useLocalSearchParams<{ seconds?: string }>();
  const context = getRestContext();
  const initialSeconds = Number(params.seconds ?? context?.seconds ?? 90) || 90;

  const [totalSeconds, setTotalSeconds] = useState(initialSeconds);
  const [endsAt, setEndsAt] = useState(() => Date.now() + initialSeconds * 1000);
  const [remaining, setRemaining] = useState(initialSeconds);
  const [isFinished, setIsFinished] = useState(false);
  /**
   * One-shot guard on the return navigation.
   *
   * Without it the 250 ms interval keeps producing ever-more-negative values after the
   * countdown expires, and each one re-fires the effect below. `router.back()` is not
   * instantaneous on a device -- the native transition and the JS thread both take time -- so
   * several ticks land before this screen actually unmounts, and each pops another entry.
   * That would eject the athlete out of the live workout itself, not just out of rest.
   */
  const hasReturned = useRef(false);

  useEffect(() => {
    if (isFinished) return;
    const tick = () => setRemaining((endsAt - Date.now()) / 1000);
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt, isFinished]);

  /**
   * Schedules the "rest complete" notification, re-scheduling whenever `endsAt` moves (the
   * ±15/+30 adjusters). Cancelling in the cleanup is what makes the pair symmetric: every exit
   * -- expiry, Skip Rest, hardware back, or an adjustment that supersedes it -- cancels the
   * outstanding one, so the phone never buzzes for a rest the athlete already finished.
   */
  useEffect(() => {
    if (isFinished) return;
    let scheduled: string | null = null;
    let cancelled = false;

    void scheduleRestEndNotification(Math.max(0, Math.round((endsAt - Date.now()) / 1000))).then((identifier) => {
      // The screen may already have gone by the time the schedule resolves; cancel immediately
      // rather than leaving an orphan to fire later.
      if (cancelled) {
        void cancelRestEndNotification(identifier);
        return;
      }
      scheduled = identifier;
    });

    return () => {
      cancelled = true;
      void cancelRestEndNotification(scheduled);
    };
  }, [endsAt, isFinished]);

  useEffect(() => {
    if (remaining > 0 || hasReturned.current) return;
    hasReturned.current = true;
    setIsFinished(true);
    // Rest is over: the prototype returns straight to the live screen rather than waiting for
    // a tap, so the next set is one glance away.
    router.back();
  }, [remaining]);

  const skip = () => {
    if (hasReturned.current) return;
    hasReturned.current = true;
    setIsFinished(true);
    router.back();
  };

  const adjust = (delta: number) => {
    const next = Math.max(0, remaining + delta);
    setEndsAt(Date.now() + next * 1000);
    // The ring must never overflow: growing the remaining time past the original total grows
    // the total with it, exactly as the prototype's `restTotal` does.
    setTotalSeconds((current) => Math.max(current, next));
  };

  return (
    <ScreenBackground>
      <View className="flex-1 px-screen-x pb-[26px]">
        <View className="flex-row items-center justify-between">
          <Text className="font-archivo text-[10px] font-semibold uppercase tracking-[.14em] text-accent">Rest</Text>
        </View>

        <View className="flex-1 items-center justify-center" style={{ gap: 26 }}>
          <CountdownRing
            progress={totalSeconds > 0 ? Math.max(0, remaining) / totalSeconds : 0}
            label={formatSeconds(remaining)}
            caption="until next set"
          />

          <View className="items-center">
            <Text className="font-archivo text-[10px] font-semibold uppercase tracking-[.14em] text-label">
              Up next
            </Text>
            <Text className="mt-[9px] font-archivo text-[19px] font-bold text-text">
              {context?.upNextName ?? 'All sets complete'}
            </Text>
            <Text className="mt-[8px] font-archivo text-[13px] font-medium text-accent">
              {context?.upNextDetail ?? 'Finish your workout'}
            </Text>
          </View>

          <View className="flex-row" style={{ gap: 9 }}>
            {(
              [
                ['−15s', -15],
                ['+30s', 30],
              ] as const
            ).map(([label, delta]) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={delta < 0 ? 'Shorten rest by 15 seconds' : 'Extend rest by 30 seconds'}
                onPress={() => adjust(delta)}
                className="rounded-[10px] px-[20px] py-[11px]"
                style={{ backgroundColor: '#1A1B1D', borderWidth: 1, borderColor: colors.border }}>
                <Text className="font-archivo text-[13px] font-semibold text-text">{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip rest"
          onPress={skip}
          className="h-[52px] items-center justify-center rounded-[12px]"
          style={{ borderWidth: 1, borderColor: colors.border }}>
          <Text className="font-archivo text-[14px] font-semibold text-dim">Skip Rest</Text>
        </Pressable>
      </View>
    </ScreenBackground>
  );
}
