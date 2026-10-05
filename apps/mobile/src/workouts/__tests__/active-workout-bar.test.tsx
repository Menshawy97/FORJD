// 12B-2b. The in-app bar for a workout in progress, drawn to the owner-approved replica (2026-10-04): a card
// floating above the tab bar with the workout name, a running time and the current set; tapping it returns to
// the workout; the x discards it, after an "are you sure?" sheet like the exercise screen's delete.
//
// NOTE: RTL v14 -- render() and every fireEvent.* return Promises and must be awaited.
import { act, fireEvent, render as rtlRender, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { BackHandler } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { startSession, type LiveSession } from '../live-session';
import type { ActiveWorkoutState } from '../active-workout';

// The glyph is what the owner approved (a bin, not the app's x): a stub that names it keeps the test about that.
jest.mock('@/components/icon', () => {
  const { Text } = require('react-native');
  return { Icon: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text> };
});

const mockPush = jest.fn();
const mockSegments = jest.fn((): string[] => ['(tabs)', 'index']);
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useSegments: () => mockSegments(),
}));

const T0 = Date.UTC(2026, 9, 4, 10, 0, 0);
const mockStart = T0;

let mockState: ActiveWorkoutState;
let mockRest: { endsAt: number; totalSeconds: number } | null = null;
let mockUnits: Record<string, string> = {};
const mockDiscard = jest.fn().mockResolvedValue(undefined);
jest.mock('@/workouts/use-active-workout', () => ({ useActiveWorkout: () => mockState }));
jest.mock('@/workouts/active-workout', () => ({
  activeWorkout: {
    elapsedSeconds: (nowMs: number) => Math.max(0, Math.floor((nowMs - mockStart) / 1000)),
    discard: (...args: unknown[]) => mockDiscard(...args),
  },
}));
jest.mock('@/workouts/workout-notice', () => ({
  workoutNotice: {
    getRest: () => mockRest,
    getUnits: () => mockUnits,
    subscribeRest: () => () => undefined,
  },
}));

import { ActiveWorkoutBar } from '../active-workout-bar';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 20 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

function makeSession(over: Partial<LiveSession> = {}): LiveSession {
  return {
    ...startSession({
      id: 'session-1',
      templateId: null,
      name: 'Upper Body Push',
      activity: 'strength',
      startedAt: new Date(T0),
      exercises: [
        {
          exerciseId: 'bench',
          name: 'Bench Press',
          measure: 'weight',
          sets: [
            { weightKg: 82.5, reps: 6 },
            { weightKg: 82.5, reps: 6 },
            { weightKg: 80, reps: 8 },
          ],
        },
      ],
    }),
    ...over,
  };
}

function withSetsDone(session: LiveSession, count: number): LiveSession {
  return {
    ...session,
    exercises: session.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set, index) => ({ ...set, isCompleted: index < count })),
    })),
  };
}

const state = (session: LiveSession | null, extra: Partial<ActiveWorkoutState> = {}): ActiveWorkoutState => ({
  session,
  pausedMs: 0,
  pausedSince: null,
  isLogging: true,
  logFailures: 0,
  resumed: false,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date(T0 + 754_000));
  mockSegments.mockReturnValue(['(tabs)', 'index']);
  mockRest = null;
  mockUnits = {};
  mockState = state(withSetsDone(makeSession(), 2));
});

afterEach(() => {
  jest.useRealTimers();
});

const bar = () => <ActiveWorkoutBar tabBarHeight={64} />;

describe('what the bar says', () => {
  it('shows the workout name, its running time and the current set', async () => {
    const { findByText } = await render(bar());

    expect(await findByText('Upper Body Push')).toBeTruthy();
    expect(await findByText('12:34')).toBeTruthy();
    expect(await findByText('Bench Press · Set 3 of 3 · 80 kg × 8')).toBeTruthy();
  });

  it('keeps counting once a second', async () => {
    const { findByText } = await render(bar());

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(await findByText('12:39')).toBeTruthy();
  });

  it('shows the rest countdown and what is next while resting', async () => {
    mockState = state(withSetsDone(makeSession(), 1));
    mockRest = { endsAt: T0 + 754_000 + 72_000, totalSeconds: 90 };
    const { findByText, queryByText } = await render(bar());

    expect(await findByText('Rest')).toBeTruthy();
    expect(await findByText('1:12')).toBeTruthy();
    expect(await findByText('Next · Bench Press · 82.5 kg × 6')).toBeTruthy();
    expect(queryByText('12:34')).toBeNull();
  });

  it('says paused, with no running time, while paused', async () => {
    mockState = state(makeSession({ status: 'paused' }), { pausedSince: T0 + 600_000 });
    const { findByText, queryByText } = await render(bar());

    expect(await findByText('Paused')).toBeTruthy();
    expect(await findByText('Bench Press · Set 1 of 3')).toBeTruthy();
    expect(queryByText('12:34')).toBeNull();
  });

  it('says every set is done and that tapping finishes the workout', async () => {
    mockState = state(withSetsDone(makeSession(), 3));
    const { findByText } = await render(bar());

    expect(await findByText('All sets complete · tap to finish')).toBeTruthy();
  });

  it('shows the load in the unit the exercise is read in', async () => {
    mockUnits = { bench: 'lb' };
    mockState = state(makeSession());
    const { findByText } = await render(bar());

    expect(await findByText('Bench Press · Set 1 of 3 · 182 lb × 6')).toBeTruthy();
  });
});

describe('when the bar shows', () => {
  it('shows nothing without a workout', async () => {
    mockState = state(null);
    const { queryByLabelText } = await render(bar());

    expect(queryByLabelText('Return to workout')).toBeNull();
  });

  it('shows nothing for a workout that is finished', async () => {
    mockState = state(makeSession({ status: 'completed' }));
    const { queryByLabelText } = await render(bar());

    expect(queryByLabelText('Return to workout')).toBeNull();
  });

  it.each([['live'], ['rest'], ['set-timer'], ['workout-done']])(
    'is hidden on the %s screen, which is the workout itself or its end',
    async (screen) => {
      mockSegments.mockReturnValue([screen]);
      const { queryByLabelText } = await render(bar());

      expect(queryByLabelText('Return to workout')).toBeNull();
    },
  );

  it.each([[['(tabs)', 'train']], [['library']], [['exercise', '[id]']]])('shows on %j', async (segments) => {
    mockSegments.mockReturnValue(segments);
    const { findByLabelText } = await render(bar());

    expect(await findByLabelText('Return to workout')).toBeTruthy();
  });

  it('floats above the tab bar on the tabs, and above the bottom edge elsewhere', async () => {
    const bottomOf = (style: unknown): number | undefined =>
      ([] as Array<{ bottom?: number } | null | undefined>)
        .concat(style as never)
        .flat(3)
        .find((entry) => entry?.bottom !== undefined)?.bottom;

    const onTabs = await render(bar());
    const tabsStyle = (await onTabs.findByTestId('active-workout-bar')).props.style;
    await onTabs.unmount();

    mockSegments.mockReturnValue(['library']);
    const elsewhere = await render(bar());
    const otherStyle = (await elsewhere.findByTestId('active-workout-bar')).props.style;

    // The tab bar is 64 plus the 20 inset, and the bar sits 8 above it. Elsewhere: the inset plus 12.
    expect(bottomOf(tabsStyle)).toBe(64 + 20 + 8);
    expect(bottomOf(otherStyle)).toBe(20 + 12);
  });
});

describe('what the bar does', () => {
  it('opens the workout when it is tapped', async () => {
    const { findByLabelText } = await render(bar());

    await fireEvent.press(await findByLabelText('Return to workout'));

    expect(mockPush).toHaveBeenCalledWith('/live');
  });

  it('asks before discarding, and does nothing yet', async () => {
    const { findByLabelText, findByText } = await render(bar());

    await fireEvent.press(await findByLabelText('Discard workout'));

    expect(await findByText('Discard this workout?')).toBeTruthy();
    expect(await findByText('Your sets so far will be deleted and nothing will be saved.')).toBeTruthy();
    expect(mockDiscard).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('keeps the workout when the athlete cancels', async () => {
    const { findByLabelText, findByText, queryByText } = await render(bar());
    await fireEvent.press(await findByLabelText('Discard workout'));

    await fireEvent.press(await findByText('Cancel'));

    expect(queryByText('Discard this workout?')).toBeNull();
    expect(mockDiscard).not.toHaveBeenCalled();
    expect(await findByLabelText('Return to workout')).toBeTruthy();
  });

  it('throws the workout away when the athlete confirms', async () => {
    const { findByLabelText, findByText } = await render(bar());
    await fireEvent.press(await findByLabelText('Discard workout'));

    await fireEvent.press(await findByText('Discard'));

    expect(mockDiscard).toHaveBeenCalledTimes(1);
  });

  it('cannot discard twice by tapping fast', async () => {
    const { findByLabelText, findByText } = await render(bar());
    await fireEvent.press(await findByLabelText('Discard workout'));
    const discard = await findByText('Discard');

    await fireEvent.press(discard);
    await fireEvent.press(discard);

    expect(mockDiscard).toHaveBeenCalledTimes(1);
  });
});

describe('the discard button', () => {
  it('shows the trash glyph, not the x', async () => {
    const { findByLabelText } = await render(bar());

    const button = await findByLabelText('Discard workout');

    expect(within(button).getByText('icon:trash')).toBeTruthy();
    expect(within(button).queryByText('icon:x')).toBeNull();
  });
});

describe('reaching the bar with a screen reader, and its sheet', () => {
  it('keeps the discard button outside the card, so it can be focused on its own', async () => {
    const { findByLabelText } = await render(bar());

    const card = await findByLabelText('Return to workout');

    expect(within(card).queryByLabelText('Discard workout')).toBeNull();
  });

  it('describes the workout on the card itself, so a screen reader hears more than "Return to workout"', async () => {
    const { findByLabelText } = await render(bar());

    const card = await findByLabelText('Return to workout');

    expect(card.props.accessibilityValue?.text).toBe('Upper Body Push, 12:34. Bench Press · Set 3 of 3 · 80 kg × 8');
  });

  it('puts the sheet away if the bar hides while it is open, so it does not pop up again later', async () => {
    const view = await render(bar());
    await fireEvent.press(await view.findByLabelText('Discard workout'));
    expect(await view.findByText('Discard this workout?')).toBeTruthy();

    mockSegments.mockReturnValue(['live']);
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ActiveWorkoutBar tabBarHeight={64} />
      </SafeAreaProvider>,
    );
    mockSegments.mockReturnValue(['(tabs)', 'index']);
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ActiveWorkoutBar tabBarHeight={64} />
      </SafeAreaProvider>,
    );

    expect(view.queryByText('Discard this workout?')).toBeNull();
  });

  it('labels the sheet buttons and lets a tap on the scrim close it', async () => {
    const { findByLabelText, queryByText } = await render(bar());
    await fireEvent.press(await findByLabelText('Discard workout'));

    expect(await findByLabelText('Cancel discarding')).toBeTruthy();
    expect(await findByLabelText('Discard this workout')).toBeTruthy();

    await fireEvent.press(await findByLabelText('Close'));

    expect(queryByText('Discard this workout?')).toBeNull();
    expect(mockDiscard).not.toHaveBeenCalled();
  });

  it('closes the sheet on the Android back button, and leaves the workout alone', async () => {
    let onBack: (() => boolean) | null = null;
    const remove = jest.fn();
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      onBack = handler as () => boolean;
      return { remove };
    });
    const { findByLabelText, queryByText } = await render(bar());
    await fireEvent.press(await findByLabelText('Discard workout'));

    let handled = false;
    await act(async () => {
      handled = onBack?.() ?? false;
    });

    expect(handled).toBe(true);
    expect(queryByText('Discard this workout?')).toBeNull();
    expect(mockDiscard).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
