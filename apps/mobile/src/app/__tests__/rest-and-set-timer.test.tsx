// Phase 3H, slice H3 -- the rest screen and the timed-set screen.
//
// **Neither screen has a reference screenshot.** The screenshots folder holds `live workout.png`
// and `live workout 2.png` and nothing for rest or the timer, so under the standing design
// precedence the prototype's own `s_rest()` (~line 2067) and `s_setTimer()` (~line 3121) are
// authoritative, and these tests pin what those functions actually render.
//
// Both countdowns are **wall-clock based** rather than tick-counting, because a backgrounded
// app's interval is throttled or suspended -- a phone locked for a whole rest period would
// otherwise come back showing almost the full ninety seconds. The tests advance both the fake
// clock and the fake timers together, which is what that design requires.
//
// NOTE: RTL v14 -- render() and every fireEvent.* return Promises and must be awaited.
import { act, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import { Profiler, type ReactElement } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockBack = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}) as Record<string, string>);

jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

// The notification seam is exercised on its own in workouts/__tests__/rest-notifications.test.ts;
// here it is mocked so these screen tests stay about the countdown behaviour.
const mockSchedule = jest.fn().mockResolvedValue('notification-1');
const mockCancel = jest.fn().mockResolvedValue(undefined);
jest.mock('@/workouts/rest-notifications', () => ({
  scheduleRestEndNotification: (...args: unknown[]) => mockSchedule(...args),
  cancelRestEndNotification: (...args: unknown[]) => mockCancel(...args),
}));

import { consumeCompletedTimedSet, setRestContext, setTimerContext } from '@/workouts/live-handoff';

import RestScreen from '../rest';
import SetTimerScreen from '../set-timer';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

/**
 * Advances the countdowns. Jest's modern fake timers move `Date.now()` along with the timer
 * queue, so `advanceTimersByTime` alone is enough -- calling `setSystemTime` as well would
 * double-count the elapsed time, which is exactly the trap these wall-clock countdowns are
 * sensitive to.
 */
async function advanceSeconds(seconds: number) {
  await act(async () => {
    jest.advanceTimersByTime(seconds * 1000);
  });
}

let announceSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consumeCompletedTimedSet();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-03T10:00:00.000Z'));
  mockUseLocalSearchParams.mockReturnValue({});
  announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  announceSpy.mockRestore();
});

describe('the rest screen', () => {
  beforeEach(() => {
    setRestContext({ seconds: 90, upNextName: 'Bench Press', upNextDetail: '80 kg × 8 reps' });
  });

  it('opens at the rest length it was given', async () => {
    const { findByText } = await render(<RestScreen />);

    expect(await findByText('1:30')).toBeTruthy();
    expect(await findByText('until next set')).toBeTruthy();
  });

  it('names what is coming, which is the point of the screen', async () => {
    const { findByText } = await render(<RestScreen />);

    expect(await findByText('Up next')).toBeTruthy();
    expect(await findByText('Bench Press')).toBeTruthy();
    expect(await findByText('80 kg × 8 reps')).toBeTruthy();
  });

  it('says the workout is finished when there is no next set', async () => {
    setRestContext({ seconds: 90, upNextName: null, upNextDetail: null });
    const { findByText } = await render(<RestScreen />);

    expect(await findByText('All sets complete')).toBeTruthy();
    expect(await findByText('Finish your workout')).toBeTruthy();
  });

  it('counts down against the wall clock, not by counting ticks', async () => {
    const { findByText } = await render(<RestScreen />);

    await advanceSeconds(20);

    expect(await findByText('1:10')).toBeTruthy();
  });

  it('returns to the workout on its own once rest is over', async () => {
    await render(<RestScreen />);

    await advanceSeconds(91);

    expect(mockBack).toHaveBeenCalled();
  });

  it('shortens by fifteen and extends by thirty -- the prototype asymmetric pair', async () => {
    const { findByLabelText, findByText } = await render(<RestScreen />);

    await fireEvent.press(await findByLabelText('Shorten rest by 15 seconds'));
    expect(await findByText('1:15')).toBeTruthy();

    await fireEvent.press(await findByLabelText('Extend rest by 30 seconds'));
    expect(await findByText('1:45')).toBeTruthy();
  });

  it('schedules a notification for the end of the rest period', async () => {
    await render(<RestScreen />);

    await waitFor(() => expect(mockSchedule).toHaveBeenCalledWith(90));
  });

  it('cancels the notification when the athlete skips rest early', async () => {
    const { findByLabelText, unmount } = await render(<RestScreen />);
    await waitFor(() => expect(mockSchedule).toHaveBeenCalled());

    await fireEvent.press(await findByLabelText('Skip rest'));
    await act(async () => {
      await unmount();
    });

    // Otherwise the phone buzzes for a rest the athlete already finished.
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('notification-1'));
  });

  it('skips straight back to the workout', async () => {
    const { findByLabelText } = await render(<RestScreen />);

    await fireEvent.press(await findByLabelText('Skip rest'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  /**
   * Regression: the countdown's 250 ms interval used to keep running past zero, and every
   * further tick re-fired the return effect. `router.back()` is not instant on a device, so
   * several ticks land before the screen unmounts -- each popping another entry and ejecting
   * the athlete out of the live workout itself, not just out of rest.
   *
   * Advanced in small steps on purpose: one big `advanceTimersByTime` coalesces the ticks into
   * a single re-render and hides exactly this bug.
   */
  it('returns exactly once, however many ticks land after it expires', async () => {
    await render(<RestScreen />);

    for (let i = 0; i < 40; i += 1) {
      await advanceSeconds(3);
    }

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('cannot double-return when skip is tapped twice', async () => {
    const { findByLabelText } = await render(<RestScreen />);

    const skip = await findByLabelText('Skip rest');
    await fireEvent.press(skip);
    await fireEvent.press(skip);

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  /**
   * R18 (H12): a blind athlete got no countdown at all -- `announceForAccessibility` never
   * fired. It must not fire on every 250ms tick either, which would talk over itself; the
   * schedule is coarse instead -- every fifth second while there is time to spare (55, 50, ...,
   * 15 of a 60-second rest), then every single second once it matters (10, 9, ..., 1), plus
   * "Time's up" exactly once on expiry. That is 9 + 10 + 1 = 20 calls total.
   *
   * Advanced one second at a time on purpose, same as the double-return regression above -- one
   * big `advanceTimersByTime` coalesces React's batched re-renders and silently skips seconds.
   */
  it('announces the countdown on a coarse schedule, not on every tick', async () => {
    setRestContext({ seconds: 60, upNextName: 'Bench Press', upNextDetail: '80 kg × 8 reps' });
    await render(<RestScreen />);

    for (let i = 0; i < 60; i += 1) {
      await advanceSeconds(1);
    }

    expect(announceSpy).toHaveBeenCalledTimes(20);
  });

  it('announces "time\'s up" exactly once when the rest period expires', async () => {
    setRestContext({ seconds: 60, upNextName: 'Bench Press', upNextDetail: '80 kg × 8 reps' });
    await render(<RestScreen />);

    for (let i = 0; i < 60; i += 1) {
      await advanceSeconds(1);
    }

    const timesUpCalls = announceSpy.mock.calls.filter(([message]) => message === "Time's up");
    expect(timesUpCalls).toHaveLength(1);
  });

  /**
   * R21 (H15): the countdown used to tick every 250ms, re-rendering this screen (and the
   * countdown ring's SVG) up to four times a second -- 1,400 to 2,900 renders across a real
   * workout, all on the JS thread. It now ticks once a second, matching `live.tsx`'s elapsed
   * clock, so a 60-second countdown should commit roughly 60 times from the countdown alone,
   * not roughly 240. `React.Profiler`'s `onRender` fires once per commit, which is exactly the
   * signal a render-frequency regression needs -- counting `setState` calls would not catch a
   * change that fires the same number of `setState`s more often, only a change in commits does.
   *
   * Advanced one second at a time, same as the coarse-announcement tests above -- one big
   * `advanceTimersByTime` would coalesce React's batched updates into far fewer commits than
   * the countdown actually produces on a real device and hide the regression this guards.
   */
  it('renders about once a second while counting down, not about four times a second', async () => {
    setRestContext({ seconds: 60, upNextName: 'Bench Press', upNextDetail: '80 kg × 8 reps' });
    const onRender = jest.fn();
    await render(
      <Profiler id="rest-timer" onRender={onRender}>
        <RestScreen />
      </Profiler>,
    );
    const rendersBeforeCountdown = onRender.mock.calls.length;

    for (let i = 0; i < 60; i += 1) {
      await advanceSeconds(1);
    }

    const countdownRenders = onRender.mock.calls.length - rendersBeforeCountdown;
    // ~60 at 1Hz, ~240 at the old 4Hz -- the midpoint below cleanly separates the two.
    expect(countdownRenders).toBeLessThan(100);
  });
});

describe('the timed-set screen', () => {
  beforeEach(() => {
    setTimerContext({ exerciseIndex: 1, setIndex: 0, exerciseName: 'Plank', seconds: 45 });
  });

  it('opens at the target and names the set being held', async () => {
    const { findByText } = await render(<SetTimerScreen />);

    expect(await findByText('45')).toBeTruthy();
    expect(await findByText('hold the position')).toBeTruthy();
    expect(await findByText('Plank')).toBeTruthy();
    expect(await findByText('Set 1 · 45 s target')).toBeTruthy();
  });

  it('reports the finished set back to the live screen when it reaches zero', async () => {
    await render(<SetTimerScreen />);

    await advanceSeconds(46);

    expect(consumeCompletedTimedSet()).toEqual({ exerciseIndex: 1, setIndex: 0 });
    expect(mockBack).toHaveBeenCalled();
  });

  it('reports it immediately when the athlete taps Complete set', async () => {
    const { findByLabelText } = await render(<SetTimerScreen />);

    await fireEvent.press(await findByLabelText('Complete set'));

    expect(consumeCompletedTimedSet()).toEqual({ exerciseIndex: 1, setIndex: 0 });
  });

  it('holds the clock while paused, and does not lose the paused time on resume', async () => {
    const { findByLabelText, findByText } = await render(<SetTimerScreen />);

    await advanceSeconds(5);
    await fireEvent.press(await findByLabelText('Pause set'));
    expect(await findByText('paused')).toBeTruthy();

    await advanceSeconds(20);
    // Still forty seconds: the twenty spent paused do not count against the hold.
    expect(await findByText('40')).toBeTruthy();

    await fireEvent.press(await findByLabelText('Resume set'));
    await advanceSeconds(10);
    expect(await findByText('30')).toBeTruthy();
  });

  it('adjusts symmetrically by fifteen either way, unlike rest', async () => {
    const { findByLabelText, findByText } = await render(<SetTimerScreen />);

    await fireEvent.press(await findByLabelText('Extend set by 15 seconds'));
    expect(await findByText('60')).toBeTruthy();

    await fireEvent.press(await findByLabelText('Shorten set by 15 seconds'));
    expect(await findByText('45')).toBeTruthy();
  });

  it('closes without completing the set when dismissed', async () => {
    const { findByLabelText } = await render(<SetTimerScreen />);

    await fireEvent.press(await findByLabelText('Close timer'));

    expect(mockBack).toHaveBeenCalled();
    expect(consumeCompletedTimedSet()).toBeNull();
  });

  it('reports the set exactly once, however it ends', async () => {
    const { findByLabelText } = await render(<SetTimerScreen />);

    await fireEvent.press(await findByLabelText('Complete set'));
    await advanceSeconds(60);

    expect(consumeCompletedTimedSet()).toEqual({ exerciseIndex: 1, setIndex: 0 });
    // Drained by the line above; the expiry must not have queued a second result.
    expect(consumeCompletedTimedSet()).toBeNull();
  });

  /** Same coarse schedule as the rest screen's countdown -- see that describe block for the math. */
  it('announces the countdown on a coarse schedule, not on every tick', async () => {
    setTimerContext({ exerciseIndex: 1, setIndex: 0, exerciseName: 'Plank', seconds: 60 });
    await render(<SetTimerScreen />);

    for (let i = 0; i < 60; i += 1) {
      await advanceSeconds(1);
    }

    expect(announceSpy).toHaveBeenCalledTimes(20);
  });

  it('announces "time\'s up" exactly once when the hold expires on its own', async () => {
    setTimerContext({ exerciseIndex: 1, setIndex: 0, exerciseName: 'Plank', seconds: 60 });
    await render(<SetTimerScreen />);

    for (let i = 0; i < 60; i += 1) {
      await advanceSeconds(1);
    }

    const timesUpCalls = announceSpy.mock.calls.filter(([message]) => message === "Time's up");
    expect(timesUpCalls).toHaveLength(1);
  });

  it('does not announce "time\'s up" when the athlete completes the set manually', async () => {
    const { findByLabelText } = await render(<SetTimerScreen />);

    await fireEvent.press(await findByLabelText('Complete set'));

    const timesUpCalls = announceSpy.mock.calls.filter(([message]) => message === "Time's up");
    expect(timesUpCalls).toHaveLength(0);
  });

  /** Same regression and the same reasoning as the rest screen's matching test above. */
  it('renders about once a second while holding, not about four times a second', async () => {
    setTimerContext({ exerciseIndex: 1, setIndex: 0, exerciseName: 'Plank', seconds: 60 });
    const onRender = jest.fn();
    await render(
      <Profiler id="set-timer" onRender={onRender}>
        <SetTimerScreen />
      </Profiler>,
    );
    const rendersBeforeCountdown = onRender.mock.calls.length;

    for (let i = 0; i < 60; i += 1) {
      await advanceSeconds(1);
    }

    const countdownRenders = onRender.mock.calls.length - rendersBeforeCountdown;
    expect(countdownRenders).toBeLessThan(100);
  });
});
