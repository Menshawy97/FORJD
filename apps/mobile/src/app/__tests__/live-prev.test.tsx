// The live workout's PREV column and start-filled sets (docs/product/live-prev-column-plan.md; replica approved
// 2026-10-14). PREV shows last time's same set; today's untouched sets fill with it; a set already typed into is never
// overwritten; a never-done exercise stays "—"; Finish keeps the workout's sets as last time's on the phone.
//
// The loader is mocked so each test decides when last time's sets arrive; its own rules are covered in
// `workouts/__tests__/load-previous-sets.test.ts`. Mocks otherwise follow live.test.tsx.
import { act, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
    useFocusEffect: (callback: () => void) => {
      react.useEffect(() => {
        callback();
      }, []);
    },
  };
});
jest.mock('@/store/exercise-unit-preferences', () => ({
  getExerciseUnits: jest.fn().mockResolvedValue({}),
  setExerciseUnit: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/store/workout-session', () => ({
  openWorkoutSessionDb: jest.fn(),
  ensureWorkoutSessionSchema: jest.fn(),
  appendSessionEvent: jest.fn(),
  saveSessionSnapshot: jest.fn(),
  getUnfinishedSessionSnapshot: jest.fn(),
  clearSessionSnapshot: jest.fn(),
  getSessionEvents: jest.fn(),
  replaySessionState: jest.fn(),
  enqueueSessionUpload: jest.fn(),
}));
jest.mock('@/integrations/notifications/ongoing-notice', () => ({
  ongoingNotice: {
    isAvailable: () => true,
    show: jest.fn().mockResolvedValue(false),
    dismiss: jest.fn().mockResolvedValue(undefined),
    onAction: () => () => undefined,
  },
}));
jest.mock('@/workouts/capture-start-location', () => ({ captureStartLocation: jest.fn() }));
jest.mock('@/auth/apiClient', () => ({}));

type OnUpdate = (exerciseId: string, sets: unknown[]) => void;
let mockOnUpdate: OnUpdate | null = null;
jest.mock('@/workouts/load-previous-sets', () => ({
  loadPreviousSets: jest.fn((_ids: string[], onUpdate: OnUpdate) => {
    mockOnUpdate = onUpdate;
    return Promise.resolve();
  }),
  rememberFinishedWorkout: jest.fn().mockResolvedValue(undefined),
}));

import {
  appendSessionEvent,
  clearSessionSnapshot,
  enqueueSessionUpload,
  ensureWorkoutSessionSchema,
  getSessionEvents,
  getUnfinishedSessionSnapshot,
  openWorkoutSessionDb,
  saveSessionSnapshot,
} from '@/store/workout-session';
import { captureStartLocation } from '@/workouts/capture-start-location';
import { consumePendingLiveSession, setPendingLiveSession } from '@/workouts/live-handoff';
import { activeWorkout } from '@/workouts/active-workout';
import { loadPreviousSets, rememberFinishedWorkout } from '@/workouts/load-previous-sets';
import { workoutNotice } from '@/workouts/workout-notice';

import LiveScreen from '../live';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const render = (ui: ReactElement) => rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

const BENCH = 'ex-bench';
const INCLINE = 'ex-incline';
const blank = (setIndex: number) => ({
  setIndex,
  isCompleted: false,
  weightKg: null,
  reps: 10,
  durationSeconds: null,
  distanceMeters: null,
});
const last = (weightKg: number, reps: number) => ({ weightKg, reps, durationSeconds: null, distanceMeters: null });

function stageSession() {
  setPendingLiveSession({
    id: 'session-prev',
    templateId: null,
    name: 'Bench Day',
    activity: 'strength',
    exercises: [
      { exerciseId: BENCH, name: 'Bench Press', measure: 'weight', goal: 'strength', sets: [blank(0), blank(1), blank(2), blank(3)] },
      { exerciseId: INCLINE, name: 'Incline Press', measure: 'weight', goal: 'strength', sets: [blank(0)] },
    ],
  });
}

type Screen = { getByLabelText: (label: string) => { props: { value?: string } } };
const weightOf = (screen: Screen, set: number, name: string) =>
  screen.getByLabelText(`Weight for set ${set} of ${name}`).props.value;
const repsOf = (screen: Screen, set: number, name: string) =>
  screen.getByLabelText(`Reps for set ${set} of ${name}`).props.value;

let unbindNotice: (() => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  mockOnUpdate = null;
  activeWorkout.clear();
  workoutNotice.skipRest();
  unbindNotice = workoutNotice.bind();
  consumePendingLiveSession();
  (openWorkoutSessionDb as jest.Mock).mockResolvedValue({});
  (ensureWorkoutSessionSchema as jest.Mock).mockResolvedValue(undefined);
  (appendSessionEvent as jest.Mock).mockResolvedValue(undefined);
  (saveSessionSnapshot as jest.Mock).mockResolvedValue(undefined);
  (clearSessionSnapshot as jest.Mock).mockResolvedValue(undefined);
  (enqueueSessionUpload as jest.Mock).mockResolvedValue(undefined);
  (getUnfinishedSessionSnapshot as jest.Mock).mockResolvedValue(null);
  (getSessionEvents as jest.Mock).mockResolvedValue([]);
  (captureStartLocation as jest.Mock).mockResolvedValue(null);
});

afterEach(() => {
  unbindNotice?.();
  activeWorkout.clear();
});

describe('PREV in the live workout', () => {
  it("shows last time's same set, and today's sets start filled with it", async () => {
    stageSession();
    const screen = await render(<LiveScreen />);
    await waitFor(() => expect(loadPreviousSets).toHaveBeenCalled());
    expect((loadPreviousSets as jest.Mock).mock.calls[0]![0]).toEqual([BENCH, INCLINE]);

    await act(async () => mockOnUpdate!(BENCH, [last(40, 10), last(40, 10), last(37.5, 8)]));

    expect(screen.getAllByText('40 × 10')).toHaveLength(2);
    screen.getByText('37.5 × 8');
    expect(weightOf(screen, 1, 'Bench Press')).toBe('40');
    expect(weightOf(screen, 3, 'Bench Press')).toBe('37.5');
    expect(repsOf(screen, 3, 'Bench Press')).toBe('8');
    // Set 4 had no match last time: "—" and the workout's own target.
    expect(weightOf(screen, 4, 'Bench Press')).toBe('');
    expect(repsOf(screen, 4, 'Bench Press')).toBe('10');
  });

  it('never overwrites a set the person already typed into', async () => {
    stageSession();
    const screen = await render(<LiveScreen />);
    await waitFor(() => expect(mockOnUpdate).not.toBeNull());

    await fireEvent.changeText(screen.getByLabelText('Weight for set 2 of Bench Press'), '55');
    await act(async () => mockOnUpdate!(BENCH, [last(40, 10), last(40, 10)]));

    expect(weightOf(screen, 1, 'Bench Press')).toBe('40');
    expect(weightOf(screen, 2, 'Bench Press')).toBe('55');
  });

  it('fills only once: a later, newer answer updates PREV but not the sets', async () => {
    stageSession();
    const screen = await render(<LiveScreen />);
    await waitFor(() => expect(mockOnUpdate).not.toBeNull());

    await act(async () => mockOnUpdate!(BENCH, [last(40, 10)]));
    await act(async () => mockOnUpdate!(BENCH, [last(42.5, 10)]));

    screen.getByText('42.5 × 10');
    expect(weightOf(screen, 1, 'Bench Press')).toBe('40');
  });

  it('leaves a never-done exercise as "—" with an empty weight', async () => {
    stageSession();
    const screen = await render(<LiveScreen />);
    await waitFor(() => expect(mockOnUpdate).not.toBeNull());

    await act(async () => mockOnUpdate!(BENCH, [last(40, 10)]));

    expect(weightOf(screen, 1, 'Incline Press')).toBe('');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it("keeps the finished workout's sets as last time's", async () => {
    stageSession();
    const screen = await render(<LiveScreen />);
    await waitFor(() => expect(mockOnUpdate).not.toBeNull());
    await act(async () => mockOnUpdate!(BENCH, [last(40, 10)]));
    await fireEvent.press(screen.getByLabelText('Complete set 1 of Bench Press'));

    await fireEvent.press(screen.getByLabelText('Finish workout'));

    await waitFor(() => expect(rememberFinishedWorkout).toHaveBeenCalledTimes(1));
    const [request] = (rememberFinishedWorkout as jest.Mock).mock.calls[0]!;
    expect(request.exercises[0]).toMatchObject({ exerciseId: BENCH });
    expect(request.exercises[0].sets[0]).toMatchObject({ isCompleted: true, weightKg: 40, reps: 10 });
  });
});
