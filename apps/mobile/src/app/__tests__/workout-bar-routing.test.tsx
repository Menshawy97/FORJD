// 12B-2b, through the real route tree: a workout that is running survives leaving the workout screen, the bar
// shows over the other screens, tapping it returns to the workout, and an unfinished workout from before the app
// closed is picked back up at launch.
import { fireEvent, waitFor } from '@testing-library/react-native';

import { renderApp } from './render-app';

jest.mock('@/auth/secureStorage', () => ({
  getAccountId: jest.fn().mockResolvedValue('account-a'),
  hasSession: jest.fn(),
  subscribeToSession: jest.fn(() => () => {}),
  getCachedHasSession: jest.fn(),
  consumeSessionExpired: jest.fn(() => false),
}));

jest.mock('@/store/workout-session', () => ({
  openWorkoutSessionDb: jest.fn().mockResolvedValue({}),
  ensureWorkoutSessionSchema: jest.fn().mockResolvedValue(undefined),
  appendSessionEvent: jest.fn().mockResolvedValue(undefined),
  saveSessionSnapshot: jest.fn().mockResolvedValue(undefined),
  getUnfinishedSessionSnapshot: jest.fn().mockResolvedValue(null),
  getSessionEvents: jest.fn().mockResolvedValue([]),
  replaySessionState: jest.fn(),
  clearSessionSnapshot: jest.fn().mockResolvedValue(undefined),
  clearSessionEvents: jest.fn().mockResolvedValue(undefined),
  enqueueSessionUpload: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/workouts/sync-sessions', () => ({ syncPendingSessions: jest.fn().mockResolvedValue({ uploaded: [], failed: [] }) }));
jest.mock('@/workouts/capture-start-location', () => ({ captureStartLocation: jest.fn().mockResolvedValue(null) }));

import { getCachedHasSession, hasSession } from '@/auth/secureStorage';
import { getUnfinishedSessionSnapshot, replaySessionState } from '@/store/workout-session';
import { activeWorkout } from '@/workouts/active-workout';
import { completeSet } from '@/workouts/live-session';

const pending = {
  id: 'session-1',
  templateId: null,
  name: 'Upper Body Push',
  activity: 'strength' as const,
  exercises: [
    {
      exerciseId: 'ex-1',
      name: 'Bench Press',
      measure: 'weight' as const,
      goal: null,
      sets: [
        { setIndex: 0, isCompleted: false, weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
        { setIndex: 1, isCompleted: false, weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
      ],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  activeWorkout.clear();
  (hasSession as jest.Mock).mockResolvedValue(true);
  (getCachedHasSession as jest.Mock).mockReturnValue(true);
  (getUnfinishedSessionSnapshot as jest.Mock).mockResolvedValue(null);
});

afterEach(() => {
  activeWorkout.clear();
});

describe('a workout in progress, outside the workout screen', () => {
  it('shows the bar over Home, and tapping it opens the workout as it was', async () => {
    activeWorkout.start(pending);
    const rendered = renderApp({ initialUrl: '/' });
    const { findByLabelText, findByText, queryByLabelText } = await rendered;

    await findByText('Home');
    await fireEvent.press(await findByLabelText('Return to workout'));

    await waitFor(() => expect(rendered.getPathname()).toBe('/live'));
    expect(await findByLabelText('Complete set 1 of Bench Press')).toBeTruthy();
    // On the workout's own screen the bar steps aside.
    expect(queryByLabelText('Return to workout')).toBeNull();
  });

  it('keeps the workout when back is pressed from it, and shows the bar again', async () => {
    const started = activeWorkout.start(pending);
    // A set already ticked (through the store, as the screen does), so there is progress to keep.
    activeWorkout.apply(completeSet(started, 0, 0, new Date()));
    const rendered = renderApp({ initialUrl: '/' });
    const { findByLabelText, findByText, queryByLabelText } = await rendered;
    await findByText('Home');
    await fireEvent.press(await findByLabelText('Return to workout'));
    expect(await findByLabelText('Complete set 2 of Bench Press')).toBeTruthy();

    // Back out of the workout: it does not end.
    await fireEvent.press(await findByLabelText('Cancel workout'));

    await waitFor(() => expect(rendered.getPathname()).toBe('/'));
    expect(activeWorkout.isActive()).toBe(true);
    expect(await findByLabelText('Return to workout')).toBeTruthy();
    expect(queryByLabelText('Complete set 2 of Bench Press')).toBeNull();
    expect(activeWorkout.getState().session?.exercises[0]?.sets[0]?.isCompleted).toBe(true);
  });

  it('shows no bar when there is no workout', async () => {
    const { findByText, queryByLabelText } = await renderApp({ initialUrl: '/' });

    await findByText('Home');

    expect(queryByLabelText('Return to workout')).toBeNull();
  });

  it('picks an unfinished workout back up at launch, so the bar is there before the workout screen opens', async () => {
    (getUnfinishedSessionSnapshot as jest.Mock).mockResolvedValue({
      sessionId: 'session-1',
      startedAt: new Date(Date.now() - 600_000).toISOString(),
      payload: { ...pending, status: 'in_progress', restSeconds: 90, startedAt: new Date().toISOString() },
    });
    (replaySessionState as jest.Mock).mockReturnValue({
      status: 'in_progress',
      durationSeconds: 300,
      completedSetKeys: [],
    });
    const { findByLabelText, findByText } = await renderApp({ initialUrl: '/' });

    await findByText('Home');

    expect(await findByLabelText('Return to workout')).toBeTruthy();
  });

  it('removes the bar once the workout is discarded from it', async () => {
    activeWorkout.start(pending);
    const { findByLabelText, findByText, queryByLabelText } = await renderApp({ initialUrl: '/' });
    await findByText('Home');

    await fireEvent.press(await findByLabelText('Discard workout'));
    await fireEvent.press(await findByText('Discard'));

    await waitFor(() => expect(queryByLabelText('Return to workout')).toBeNull());
    expect(activeWorkout.getState().session).toBeNull();
  });
});
