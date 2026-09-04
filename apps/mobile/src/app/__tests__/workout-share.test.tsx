import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockBack(...args), push: jest.fn(), replace: jest.fn() },
}));

jest.mock('@/store/exercise-catalogue', () => ({
  openExerciseCatalogueDb: jest.fn().mockResolvedValue({}),
  getCachedExercise: jest.fn().mockImplementation((_db: unknown, id: string) =>
    Promise.resolve(
      id === 'ex-1'
        ? { primaryMuscles: ['chest', 'triceps'] }
        : id === 'ex-2'
          ? { primaryMuscles: ['chest'] }
          : null,
    ),
  ),
}));

import { clearCompletedSummary, setCompletedSummary } from '@/workouts/live-handoff';

import WorkoutShareScreen from '../workout-share';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

function stageSummary(overrides: Record<string, unknown> = {}) {
  setCompletedSummary({
    name: 'Upper Body Push',
    durationSeconds: 3072,
    volumeKg: 4820,
    completedSetCount: 12,
    exerciseIds: ['ex-1', 'ex-2'],
    exercises: [
      { exerciseId: 'ex-1', name: 'Bench Press', setCount: 4, detail: '80 kg' },
      { exerciseId: 'ex-2', name: 'Incline Press', setCount: 3, detail: '30 kg' },
    ],
    origin: 'live',
    ...overrides,
  });
}

/**
 * The bug this screen fixes: finishing a workout and tapping share opened the *nutrition* cards.
 *
 * Beyond that, what these tests defend is the refusal. Three of the design's six layouts have no
 * data behind them — heart rate, route, personal record — and a share card is the one artefact
 * that leaves the app and is seen by other people. It must never be offered a layout it would
 * have to invent numbers to fill.
 */
describe('WorkoutShareScreen', () => {
  afterEach(() => {
    clearCompletedSummary();
  });

  it('shows the Share Workout header, not the nutrition one', async () => {
    stageSummary();
    const { findByText } = await render(<WorkoutShareScreen />);

    expect(await findByText('Share Workout')).toBeTruthy();
  });

  it('opens on the stats card with the real duration, volume and set count', async () => {
    stageSummary();
    const { findByText } = await render(<WorkoutShareScreen />);

    expect(await findByText('Workout Complete')).toBeTruthy();
    expect(await findByText('4,820 kg')).toBeTruthy();
    expect(await findByText('12')).toBeTruthy();
  });

  /**
   * The line this screen holds. `workout-done.tsx` already refuses to invent heart rate for its
   * own tiles; a card that gets posted publicly is not the place to start.
   */
  it('never offers a layout it would have to invent data for', async () => {
    stageSummary();
    const { queryByLabelText, findByLabelText } = await render(<WorkoutShareScreen />);

    await findByLabelText('Use the Stats Card layout');

    expect(queryByLabelText('Use the Heart Rate Zones layout')).toBeNull();
    expect(queryByLabelText('Use the Route & Splits layout')).toBeNull();
    expect(queryByLabelText('Use the Personal Record layout')).toBeNull();
  });

  it('switches to the muscles card, counting sets per muscle from the catalogue', async () => {
    stageSummary();
    const { findByLabelText, findByText } = await render(<WorkoutShareScreen />);

    await fireEvent.press(await findByLabelText('Use the Muscles Trained layout'));

    // "Muscles Trained" is both the card headline and the picker label, so the muscle rows are
    // what actually proves the card rendered.
    // Chest is worked by both exercises, triceps by one.
    expect(await findByText('Chest')).toBeTruthy();
    expect(await findByText('Triceps')).toBeTruthy();
    expect(await findByText('2 sets')).toBeTruthy();
  });

  it('switches to the exercise list and shows each exercise with its sets', async () => {
    stageSummary();
    const { findByLabelText, findByText } = await render(<WorkoutShareScreen />);

    await fireEvent.press(await findByLabelText('Use the Exercise List layout'));

    expect(await findByText('Session Breakdown')).toBeTruthy();
    expect(await findByText('Bench Press')).toBeTruthy();
    expect(await findByText('4 × 80 kg')).toBeTruthy();
  });

  /**
   * A history summary comes from the session *list* endpoint, which carries no per-exercise
   * breakdown. Offering the layout anyway would mean an empty card, or a fetch this screen has no
   * business making.
   */
  it('hides the exercise list when the summary has no per-exercise lines', async () => {
    stageSummary({ exercises: undefined, origin: 'history' });
    const { findByLabelText, queryByLabelText } = await render(<WorkoutShareScreen />);

    await findByLabelText('Use the Stats Card layout');
    expect(queryByLabelText('Use the Exercise List layout')).toBeNull();
  });

  it('says so plainly when there is no finished workout to share', async () => {
    clearCompletedSummary();
    const { findByText } = await render(<WorkoutShareScreen />);

    expect(await findByText('Finish a workout to share it.')).toBeTruthy();
  });

  it('goes back rather than trapping the athlete on the screen', async () => {
    stageSummary();
    const { findByLabelText } = await render(<WorkoutShareScreen />);

    await fireEvent.press(await findByLabelText('Back'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });
});
