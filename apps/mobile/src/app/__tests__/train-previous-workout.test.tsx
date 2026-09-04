// RED first, Phase 3J-b -- Train's "Previous Workout" card, matched against `train2.png`.
//
// This is the first thing in the app that reads a session back. Until now the client could
// only ever *write* one (`uploadWorkoutSession`, PR #85), so a finished workout vanished the
// moment its summary screen was dismissed.
//
// NOTE: RTL v14 -- render() and every fireEvent.* return Promises and must be awaited.
import { AxiosError } from 'axios';
import { fireEvent, render as rtlRender } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    useFocusEffect: (callback: () => void) => {
      react.useEffect(() => callback(), []);
    },
  };
});

jest.mock('@/auth/apiClient', () => ({
  // Phase 3K5: Home's Start Workout and Train's programs sections both read this.
  getProgramEnrollment: jest.fn().mockResolvedValue({ enrollment: null }),
  listPrograms: jest.fn().mockResolvedValue({ items: [] }),
  listWorkoutTemplates: jest.fn(),
  listWorkoutSessions: jest.fn(),
  getWorkoutSession: jest.fn(),
}));

jest.mock('@/store/exercise-catalogue', () => ({
  openExerciseCatalogueDb: jest.fn(),
  getCachedExercise: jest.fn(),
}));

import { getWorkoutSession, listWorkoutSessions, listWorkoutTemplates } from '@/auth/apiClient';
import { getCachedExercise, openExerciseCatalogueDb } from '@/store/exercise-catalogue';
import { consumePendingLiveSession, getCompletedSummary } from '@/workouts/live-handoff';

import TrainScreen from '../(tabs)/train';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

// Started "yesterday" relative to the frozen clock below.
const detail = (overrides: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  templateId: 'template-7',
  name: 'Upper Body Push',
  activity: 'strength',
  status: 'completed',
  startedAt: new Date('2026-09-02T18:00:00').toISOString(),
  endedAt: new Date('2026-09-02T18:45:12').toISOString(),
  durationSeconds: 2712,
  perceivedEffort: null,
  notes: null,
  city: null,
  citySlug: null,
  isLiveTracked: false,
  exercises: [
    {
      id: 'se-1',
      exerciseId: 'ex-bench',
      orderIndex: 0,
      measure: 'weight',
      notes: null,
      sets: [
        {
          id: 's-1',
          setIndex: 0,
          type: 'working',
          isCompleted: true,
          weightKg: 80,
          reps: 8,
          durationSeconds: null,
          distanceMeters: null,
          restSeconds: 90,
          completedAt: new Date('2026-09-02T18:10:00').toISOString(),
        },
        {
          id: 's-2',
          setIndex: 1,
          type: 'working',
          isCompleted: true,
          weightKg: 82.5,
          reps: 6,
          durationSeconds: null,
          distanceMeters: null,
          restSeconds: 90,
          completedAt: new Date('2026-09-02T18:14:00').toISOString(),
        },
      ],
    },
  ],
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-09-03T09:00:00'));
  (listWorkoutTemplates as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
  (listWorkoutSessions as jest.Mock).mockResolvedValue({
    items: [
      {
        id: SESSION_ID,
        name: 'Upper Body Push',
        activity: 'strength',
        status: 'completed',
        startedAt: new Date('2026-09-02T18:00:00').toISOString(),
        endedAt: new Date('2026-09-02T18:45:12').toISOString(),
        durationSeconds: 2712,
        perceivedEffort: null,
      },
    ],
    nextCursor: null,
  });
  (getWorkoutSession as jest.Mock).mockResolvedValue(detail());
  (openExerciseCatalogueDb as jest.Mock).mockResolvedValue({});
  (getCachedExercise as jest.Mock).mockImplementation(async (_db: unknown, id: string) =>
    id === 'ex-bench' ? { id, name: 'Bench Press', goal: 'strength', measure: 'weight' } : null,
  );
  consumePendingLiveSession();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the card', () => {
  it('shows the most recent session, which nothing in the app could read back before', async () => {
    const { findByText } = await render(<TrainScreen />);

    expect(await findByText('Previous workout')).toBeTruthy();
    expect(await findByText('Upper Body Push')).toBeTruthy();
  });

  // `avg 151 bpm` and the `PR +` badge are in the design but not in the data -- see
  // docs/product/phase-3j-plan.md. What is left is honest and is what the roadmap specifies.
  it('writes the meta line from real figures only, with no invented heart rate', async () => {
    const { findByText, queryByText } = await render(<TrainScreen />);

    expect(await findByText('Yesterday · 45:12 · 1,135 kg')).toBeTruthy();
    expect(queryByText(/bpm/)).toBeNull();
    expect(queryByText('PR +')).toBeNull();
  });

  it('names each exercise by its heaviest completed set', async () => {
    const { findByText } = await render(<TrainScreen />);

    expect(await findByText('Bench Press 82.5×6')).toBeTruthy();
  });

  it('asks for exactly one session rather than fetching a page and discarding it', async () => {
    await render(<TrainScreen />);

    expect(listWorkoutSessions).toHaveBeenCalledWith({ limit: 1 });
  });
});

describe('when there is nothing to show', () => {
  it('renders no section at all before the first workout, rather than an empty card', async () => {
    (listWorkoutSessions as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });

    const { findByText, queryByText } = await render(<TrainScreen />);

    await findByText('My workouts');
    expect(queryByText('Previous workout')).toBeNull();
  });

  // The card is an extra, and the rest of Train -- the quick actions, My Workouts -- must not
  // disappear because the session read failed.
  it('drops the card but keeps the screen when the read fails', async () => {
    (listWorkoutSessions as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const { findByText, queryByText } = await render(<TrainScreen />);

    expect(await findByText('My workouts')).toBeTruthy();
    expect(queryByText('Previous workout')).toBeNull();
  });
});

describe('Repeat', () => {
  it('starts a new session from the previous one and opens the live screen', async () => {
    const { findByLabelText } = await render(<TrainScreen />);

    await fireEvent.press(await findByLabelText('Repeat Upper Body Push'));

    expect(mockPush).toHaveBeenCalledWith('/live');
    const pending = consumePendingLiveSession();
    expect(pending?.name).toBe('Upper Body Push');
    // Attribution survives the repeat, so progression analytics still sees the template.
    expect(pending?.templateId).toBe('template-7');
    expect(pending?.exercises[0].name).toBe('Bench Press');
  });

  it('hands over a fresh session id, not the finished session it was built from', async () => {
    const { findByLabelText } = await render(<TrainScreen />);

    await fireEvent.press(await findByLabelText('Repeat Upper Body Push'));

    // The id is the sync idempotency key: reusing it would make the new workout overwrite the
    // old one on upload.
    expect(consumePendingLiveSession()?.id).not.toBe(SESSION_ID);
  });

  it('carries the logged loads over but none of the ticks', async () => {
    const { findByLabelText } = await render(<TrainScreen />);

    await fireEvent.press(await findByLabelText('Repeat Upper Body Push'));

    const sets = consumePendingLiveSession()?.exercises[0].sets ?? [];
    expect(sets.map((s) => [s.weightKg, s.reps, s.isCompleted])).toEqual([
      [80, 8, false],
      [82.5, 6, false],
    ]);
  });
});

describe('Summary', () => {
  it('opens the finished-workout screen with the session it was read from', async () => {
    const { findByLabelText } = await render(<TrainScreen />);

    await fireEvent.press(await findByLabelText('Summary of Upper Body Push'));

    expect(mockPush).toHaveBeenCalledWith('/workout-done');
    const summary = getCompletedSummary();
    expect(summary?.name).toBe('Upper Body Push');
    expect(summary?.durationSeconds).toBe(2712);
    expect(summary?.volumeKg).toBe(1135);
    expect(summary?.completedSetCount).toBe(2);
  });

  // A session read back from the server is already uploaded. Marking it 'live' would make the
  // summary screen claim it is waiting to sync and kick the queue for a session that is not
  // in it.
  it('marks the summary as history, not as a workout that has just finished', async () => {
    const { findByLabelText } = await render(<TrainScreen />);

    await fireEvent.press(await findByLabelText('Summary of Upper Body Push'));

    expect(getCompletedSummary()?.origin).toBe('history');
    expect(getCompletedSummary()?.performedAt).toBe('Yesterday');
  });
});
