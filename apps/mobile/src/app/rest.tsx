import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';

import { ScreenBackground } from '@/components/screen-background';
import { shouldAnnounceCountdownSecond } from '@/workouts/countdown-announcements';
import { CountdownRing } from '@/workouts/countdown-ring';
import { getRestContext } from '@/workouts/live-handoff';
import { workoutNotice, type ActiveRest } from '@/workouts/workout-notice';
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
 * however long the app was away.
 *
 * **The end time is not owned here** (12B-2). `workoutNotice` owns the rest, its "Rest complete"
 * alert (ADR-026) and the lock-screen countdown, so a rest also works with no screen open -- a Done
 * tapped on the lock screen starts one. This screen reads it, adjusts it and skips it through the
 * controller, and goes back when the rest ends from anywhere, the notice's Skip rest included.
 */
function formatSeconds(total: number): string {
  const safe = Math.max(0, Math.ceil(total));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

export default function RestScreen() {
  const params = useLocalSearchParams<{ seconds?: string }>();
  const context = getRestContext();
  const initialSeconds = Number(params.seconds ?? context?.seconds ?? 90) || 90;

  // The controller's rest; before it has one (a screen opened on its own) this is only the display
  // until the effect below starts it.
  const [rest, setRest] = useState<ActiveRest>(
    () => workoutNotice.getRest() ?? { endsAt: Date.now() + initialSeconds * 1000, totalSeconds: initialSeconds },
  );
  const { endsAt, totalSeconds } = rest;
  const [remaining, setRemaining] = useState(() => (endsAt - Date.now()) / 1000);
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

  /**
   * R21 (H15): was a 250ms tick, re-rendering this screen and the countdown ring's SVG up to
   * four times a second -- 1,400 to 2,900 renders across a real workout, all on the JS thread.
   * 1Hz matches `live.tsx`'s own elapsed clock (see its comment for why): still wall-clock
   * based, so a backgrounded app never drifts, but the displayed number and the announcement
   * schedule below only need to notice a change once a second. The ring's own sub-second sweep
   * moved to a Reanimated shared value inside `CountdownRing` so it keeps animating smoothly
   * between these once-a-second ticks without any extra JS-thread renders.
   */
  useEffect(() => {
    if (isFinished) return;
    const tick = () => setRemaining((endsAt - Date.now()) / 1000);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt, isFinished]);

  /**
   * Announces the countdown to a screen reader on a coarse schedule -- every fifth second while
   * there is time to spare, then every second once it matters -- rather than on every 250ms
   * tick, which would talk over itself. Seeded to the starting second so the opening render
   * (the full rest length) is never itself announced.
   */
  const lastAnnouncedSecondRef = useRef(Math.ceil(initialSeconds));

  useEffect(() => {
    if (isFinished) return;
    const intSeconds = Math.ceil(Math.max(0, remaining));
    if (intSeconds === lastAnnouncedSecondRef.current) return;
    lastAnnouncedSecondRef.current = intSeconds;
    if (shouldAnnounceCountdownSecond(intSeconds)) {
      AccessibilityInfo.announceForAccessibility(`${intSeconds} seconds remaining`);
    }
  }, [remaining, isFinished]);

  /**
   * Follows the controller's rest, and starts one if there is none (the screen opened on its own).
   *
   * A rest that ends from elsewhere -- Skip rest on the lock-screen notice -- arrives here as `null`,
   * and the screen leaves exactly as if Skip had been pressed on it. Leaving the screen by any route,
   * the hardware back button included, ends the rest and so cancels its alert: the phone never buzzes
   * for a rest the athlete already finished.
   */
  useEffect(() => {
    if (!workoutNotice.getRest()) workoutNotice.beginRest(initialSeconds);
    // The rest this screen is following: leaving must end that one, never a newer rest that began while
    // the screen was still sliding away (a Done tapped on the lock screen).
    let followedEndsAt: number | null = null;
    const follow = () => {
      const next = workoutNotice.getRest();
      if (next) {
        followedEndsAt = next.endsAt;
        setRest(next);
        return;
      }
      if (hasReturned.current) return;
      hasReturned.current = true;
      setIsFinished(true);
      router.back();
    };
    follow();
    const unsubscribe = workoutNotice.subscribeRest(follow);
    return () => {
      unsubscribe();
      if (workoutNotice.getRest()?.endsAt === followedEndsAt) workoutNotice.skipRest();
    };
  }, [initialSeconds]);

  useEffect(() => {
    if (remaining > 0 || hasReturned.current) return;
    hasReturned.current = true;
    setIsFinished(true);
    workoutNotice.skipRest();
    AccessibilityInfo.announceForAccessibility("Time's up");
    // Rest is over: the prototype returns straight to the live screen rather than waiting for
    // a tap, so the next set is one glance away.
    router.back();
  }, [remaining]);

  const skip = () => {
    if (hasReturned.current) return;
    hasReturned.current = true;
    setIsFinished(true);
    workoutNotice.skipRest();
    router.back();
  };

  const adjust = (delta: number) => workoutNotice.adjustRest(delta);

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
