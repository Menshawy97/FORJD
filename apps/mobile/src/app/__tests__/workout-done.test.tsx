// Phase 3I -- the workout summary screen, matched against `screenshots/workout done.png`.
//
// The session is already in the sync queue by the time this renders (the live screen enqueues
// on Finish), so this is a read-only report. What is worth pinning is which figures are REAL
// and which are honest empty states: duration, volume, sets and muscles worked come from the
// athlete's own session, while heart rate and calories do not exist yet and must not be
// invented -- the Phase J precedent.
//
// NOTE: RTL v14 -- render() and every fireEvent.* return Promises and must be awaited.
import { fireEvent, render as rtlRender } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  usePathname: () => '/workout-done',
}));

jest.mock('@/store/exercise-catalogue', () => ({
  openExerciseCatalogueDb: jest.fn(),
  getCachedExercise: jest.fn(),
}));

import { getCachedExercise, openExerciseCatalogueDb } from '@/store/exercise-catalogue';
import { clearCompletedSummary, setCompletedSummary } from '@/workouts/live-handoff';

import WorkoutDoneScreen from '../workout-done';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

function stageSummary(overrides: Record<string, unknown> = {}) {
  setCompletedSummary({
    name: 'Upper / Lower',
    durationSeconds: 754,
    volumeKg: 1280,
    completedSetCount: 12,
    exerciseIds: ['ex-1', 'ex-2'],
    ...overrides,
  } as Parameters<typeof setCompletedSummary>[0]);
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCompletedSummary();
  (openExerciseCatalogueDb as jest.Mock).mockResolvedValue({});
  (getCachedExercise as jest.Mock).mockResolvedValue(null);
});

describe('the report', () => {
  it('names the session and says it will sync', async () => {
    stageSummary();

    const { findByText } = await render(<WorkoutDoneScreen />);

    expect(await findByText('Session complete')).toBeTruthy();
    expect(await findByText('Upper / Lower · logged offline, will sync when you are back online.')).toBeTruthy();
  });

  it('reports the real duration, volume and set count', async () => {
    stageSummary();

    const { findByText } = await render(<WorkoutDoneScreen />);

    expect(await findByText('12:34')).toBeTruthy();
    expect(await findByText('1,280')).toBeTruthy();
    expect(await findByText('12')).toBeTruthy();
  });

  it('formats a session over an hour with hours', async () => {
    stageSummary({ durationSeconds: 3731 });

    const { findByText } = await render(<WorkoutDoneScreen />);

    expect(await findByText('1:02:11')).toBeTruthy();
  });

  it('keeps the heart-rate and calorie tiles but not their numbers', async () => {
    stageSummary();

    const { findByText, findAllByText, queryByText } = await render(<WorkoutDoneScreen />);

    // The layout survives; the invented figures do not. The prototype simulates these from
    // Math.sin(elapsed/9) and no HealthProvider feeds the app yet.
    expect(await findByText('Avg HR')).toBeTruthy();
    expect(await findByText('Peak HR')).toBeTruthy();
    expect(await findByText('Calories')).toBeTruthy();
    expect((await findAllByText('—')).length).toBe(3);
    expect(queryByText('143')).toBeNull();
    expect(queryByText('612')).toBeNull();
  });

  it('offers to connect a watch rather than drawing a fake HR chart', async () => {
    stageSummary();

    const { findByText } = await render(<WorkoutDoneScreen />);

    expect(await findByText('HR through the session')).toBeTruthy();
    expect(await findByText('Connect a watch to see your heart rate here.')).toBeTruthy();
  });

  it('says there is nothing to summarise when opened directly', async () => {
    const { findByText } = await render(<WorkoutDoneScreen />);

    expect(await findByText('No workout to summarise.')).toBeTruthy();
  });
});

describe('muscles worked', () => {
  it('tallies primary muscles from the on-device catalogue', async () => {
    stageSummary();
    (getCachedExercise as jest.Mock)
      .mockResolvedValueOnce({ primaryMuscles: ['chest', 'triceps'] })
      .mockResolvedValueOnce({ primaryMuscles: ['chest'] });

    const { findByText } = await render(<WorkoutDoneScreen />);

    expect(await findByText('Muscles worked')).toBeTruthy();
    expect(await findByText('Chest')).toBeTruthy();
    expect(await findByText('Triceps')).toBeTruthy();
    // Chest appears in both exercises, triceps in one.
    expect(await findByText('2 sets')).toBeTruthy();
    expect(await findByText('1 set')).toBeTruthy();
  });

  it('omits the section entirely rather than showing an empty card', async () => {
    stageSummary();

    const { queryByText } = await render(<WorkoutDoneScreen />);

    expect(queryByText('Muscles worked')).toBeNull();
  });

  it('survives the catalogue being unavailable', async () => {
    stageSummary();
    (openExerciseCatalogueDb as jest.Mock).mockRejectedValue(new Error('no such table'));

    const { findByText, queryByText } = await render(<WorkoutDoneScreen />);

    // The rest of the report still renders; only this one section is lost.
    expect(await findByText('Session complete')).toBeTruthy();
    expect(queryByText('Muscles worked')).toBeNull();
  });
});

describe('leaving the screen', () => {
  it('sends the check button back to Train', async () => {
    stageSummary();
    const { findByLabelText } = await render(<WorkoutDoneScreen />);

    await fireEvent.press(await findByLabelText('Done'));

    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/train');
  });

  it('offers the share card', async () => {
    stageSummary();
    const { findByLabelText } = await render(<WorkoutDoneScreen />);

    await fireEvent.press(await findByLabelText('Share workout'));

    expect(mockPush).toHaveBeenCalled();
  });
});
