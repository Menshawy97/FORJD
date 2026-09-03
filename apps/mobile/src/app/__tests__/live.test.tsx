// Phase 3H, slice H2 -- the live workout screen.
//
// The headline case is `the offline path`: with EVERY function on the API client mocked to
// reject, a full session can still be started, logged and finished. That is the explicit proof
// `phase-3-plan.md` asks for, and the reason CLAUDE.md rule 6 exists -- the network is never in
// the critical path of a live workout.
//
// `@/workouts/live-session` and `@/workouts/live-handoff` are deliberately NOT mocked: they are
// pure in-memory modules, and the point of these tests is that the screen is wired to the real
// reducer rather than to a stand-in that could drift from it. Only the SQLite store and the
// router are mocked, because those are the two real I/O boundaries.
//
// NOTE: @testing-library/react-native v14 makes render() and every fireEvent.* async -- each
// returns a Promise and MUST be awaited, or the rendered tree silently empties for every later
// test in the file.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: {
      push: (...args: unknown[]) => mockPush(...args),
      back: (...args: unknown[]) => mockBack(...args),
      replace: (...args: unknown[]) => mockReplace(...args),
    },
    useFocusEffect: (callback: () => void) => {
      react.useEffect(() => {
        callback();
      }, []);
    },
  };
});

// The third real I/O boundary, alongside SQLite and the router. The unit chip's *behaviour* is
// the subject here -- that it flips the exercise and converts what is shown -- while the store's
// own degrade-don't-throw contract is covered directly in
// `src/store/__tests__/exercise-unit-preferences.test.ts`.
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

// Every API function rejects. Nothing in the live flow may depend on one.
jest.mock('@/auth/apiClient', () => ({
  getWorkoutTemplate: jest.fn().mockRejectedValue(new Error('network is down')),
  createWorkoutTemplate: jest.fn().mockRejectedValue(new Error('network is down')),
  getExerciseCatalogue: jest.fn().mockRejectedValue(new Error('network is down')),
}));

import {
  appendSessionEvent,
  clearSessionSnapshot,
  enqueueSessionUpload,
  ensureWorkoutSessionSchema,
  getSessionEvents,
  getUnfinishedSessionSnapshot,
  openWorkoutSessionDb,
  replaySessionState,
  saveSessionSnapshot,
} from '@/store/workout-session';
import {
  consumeCompletedTimedSet,
  consumePendingLiveSession,
  getRestContext,
  getTimerContext,
  setCompletedTimedSet,
  setPendingLiveSession,
} from '@/workouts/live-handoff';

import LiveScreen, { formatElapsed } from '../live';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

function stageSession() {
  setPendingLiveSession({
    id: 'session-1',
    templateId: 'template-1',
    name: 'Upper Body Push',
    activity: 'strength',
    exercises: [
      {
        exerciseId: 'ex-1',
        name: 'Bench Press',
        measure: 'weight',
        goal: 'strength',
        sets: [
          { setIndex: 0, isCompleted: false, weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
          { setIndex: 1, isCompleted: false, weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
        ],
      },
      {
        exerciseId: 'ex-2',
        name: 'Plank',
        measure: 'time',
        goal: 'muscular_endurance',
        sets: [
          { setIndex: 0, isCompleted: false, weightKg: null, reps: null, durationSeconds: 45, distanceMeters: null },
        ],
      },
      {
        exerciseId: 'ex-3',
        name: 'Row Machine',
        measure: 'distance',
        goal: 'muscular_endurance',
        sets: [
          { setIndex: 0, isCompleted: false, weightKg: null, reps: null, durationSeconds: null, distanceMeters: 500 },
        ],
      },
    ],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  consumePendingLiveSession();
  consumeCompletedTimedSet();
  (openWorkoutSessionDb as jest.Mock).mockResolvedValue({});
  (ensureWorkoutSessionSchema as jest.Mock).mockResolvedValue(undefined);
  (appendSessionEvent as jest.Mock).mockResolvedValue(undefined);
  (saveSessionSnapshot as jest.Mock).mockResolvedValue(undefined);
  (clearSessionSnapshot as jest.Mock).mockResolvedValue(undefined);
  (enqueueSessionUpload as jest.Mock).mockResolvedValue(undefined);
  (getUnfinishedSessionSnapshot as jest.Mock).mockResolvedValue(null);
  (getSessionEvents as jest.Mock).mockResolvedValue([]);
  (replaySessionState as jest.Mock).mockReturnValue({
    status: 'in_progress',
    durationSeconds: 0,
    completedSetKeys: [],
  });
});

describe('formatElapsed', () => {
  it('reads as minutes and seconds below an hour, and adds hours beyond it', () => {
    expect(formatElapsed(4)).toBe('0:04');
    expect(formatElapsed(750)).toBe('12:30');
    expect(formatElapsed(3731)).toBe('1:02:11');
  });

  it('never renders a negative clock', () => {
    expect(formatElapsed(-5)).toBe('0:00');
  });
});

describe('the header', () => {
  it('names the session and shows it as live', async () => {
    stageSession();

    const { findByText } = await render(<LiveScreen />);

    expect(await findByText('Live · Upper Body Push')).toBeTruthy();
  });

  it('counts every prescribed set and starts at zero volume', async () => {
    stageSession();

    const { findByText } = await render(<LiveScreen />);

    expect(await findByText('0/4 sets')).toBeTruthy();
    expect(await findByText('0 kg')).toBeTruthy();
  });

  it('flips to Paused, and back, through the reducer', async () => {
    stageSession();
    const { findByLabelText, findByText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Pause workout'));
    expect(await findByText('Paused · Upper Body Push')).toBeTruthy();

    await fireEvent.press(await findByLabelText('Resume workout'));
    expect(await findByText('Live · Upper Body Push')).toBeTruthy();
  });

  it('renders nothing to run when no session was handed over', async () => {
    const { findByText } = await render(<LiveScreen />);

    expect(await findByText('No workout in progress.')).toBeTruthy();
  });
});

/**
 * Crash recovery -- the reason the log is append-only at all. The architecture doc's promise is
 * that "the app can be killed mid-session and the state rebuilt by replay"; before this slice
 * `replaySessionState` existed and was tested, but nothing called it, so a force-kill silently
 * lost the workout and orphaned its events.
 */
describe('resuming after a crash', () => {
  /**
   * Relative to the wall clock, not a literal date. The elapsed figure is computed as
   * `now - startedAt - paused`, so a fixed timestamp would sit in the future or the distant
   * past depending on when the suite runs, and the assertion would be meaningless.
   */
  const STARTED_AT = new Date(Date.now() - 754_000).toISOString();

  const snapshotOf = () => ({
    sessionId: 'session-1',
    startedAt: STARTED_AT,
    payload: {
      id: 'session-1',
      templateId: 'template-1',
      name: 'Upper Body Push',
      activity: 'strength',
      status: 'in_progress',
      restSeconds: 90,
      startedAt: STARTED_AT,
      exercises: [
        {
          exerciseId: 'ex-1',
          name: 'Bench Press',
          measure: 'weight',
          goal: 'strength',
          sets: [
            { setIndex: 0, isCompleted: false, weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
            { setIndex: 1, isCompleted: false, weightKg: 80, reps: 8, durationSeconds: null, distanceMeters: null },
          ],
        },
      ],
    },
  });

  it('snapshots the session at start, so there is something to recover from', async () => {
    stageSession();

    await render(<LiveScreen />);

    await waitFor(() => expect(saveSessionSnapshot).toHaveBeenCalledTimes(1));
    const [, sessionId, , startedAt] = (saveSessionSnapshot as jest.Mock).mock.calls[0];
    expect(sessionId).toBe('session-1');
    expect(startedAt).toEqual(expect.any(String));
  });

  it('rebuilds the workout, its ticked sets and its elapsed time', async () => {
    (getUnfinishedSessionSnapshot as jest.Mock).mockResolvedValue(snapshotOf());
    (replaySessionState as jest.Mock).mockReturnValue({
      status: 'in_progress',
      durationSeconds: 754,
      completedSetKeys: ['ex-1:0'],
    });

    const { findByText } = await render(<LiveScreen />);

    expect(await findByText('Live · Upper Body Push')).toBeTruthy();
    expect(await findByText('1/2 sets')).toBeTruthy();
    expect(await findByText('640 kg')).toBeTruthy();
    expect(await findByText('12:34')).toBeTruthy();
  });

  it('tells the athlete plainly that nothing was lost', async () => {
    (getUnfinishedSessionSnapshot as jest.Mock).mockResolvedValue(snapshotOf());

    const { findByText } = await render(<LiveScreen />);

    expect(await findByText('Session resumed — your logged sets were recovered')).toBeTruthy();
  });

  it('comes back paused when it was left paused', async () => {
    (getUnfinishedSessionSnapshot as jest.Mock).mockResolvedValue(snapshotOf());
    (replaySessionState as jest.Mock).mockReturnValue({
      status: 'paused',
      durationSeconds: 60,
      completedSetKeys: [],
    });

    const { findByText } = await render(<LiveScreen />);

    expect(await findByText('Paused · Upper Body Push')).toBeTruthy();
  });

  it('does not resume a session that already finished, and drops its snapshot', async () => {
    (getUnfinishedSessionSnapshot as jest.Mock).mockResolvedValue(snapshotOf());
    (replaySessionState as jest.Mock).mockReturnValue({
      status: 'completed',
      durationSeconds: 900,
      completedSetKeys: ['ex-1:0', 'ex-1:1'],
    });

    const { findByText } = await render(<LiveScreen />);

    // A finished session belongs to the sync queue, not to another workout.
    expect(await findByText('No workout in progress.')).toBeTruthy();
    await waitFor(() => expect(clearSessionSnapshot).toHaveBeenCalledWith({}, 'session-1'));
  });

  it('prefers a freshly started session over a recoverable one', async () => {
    (getUnfinishedSessionSnapshot as jest.Mock).mockResolvedValue(snapshotOf());
    stageSession();

    const { findByText } = await render(<LiveScreen />);

    // Four sets is the newly staged session; the snapshot has two.
    expect(await findByText('0/4 sets')).toBeTruthy();
    expect(getUnfinishedSessionSnapshot).not.toHaveBeenCalled();
  });

  it('clears the snapshot when the workout is finished', async () => {
    stageSession();
    const { findByLabelText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Finish workout'));

    await waitFor(() => expect(clearSessionSnapshot).toHaveBeenCalledWith({}, 'session-1'));
  });
});

describe('the set table', () => {
  it('renders a weight exercise with its kg and reps fields', async () => {
    stageSession();
    const { findByLabelText } = await render(<LiveScreen />);

    expect((await findByLabelText('Weight for set 1 of Bench Press')).props.value).toBe('80');
    expect((await findByLabelText('Reps for set 1 of Bench Press')).props.value).toBe('8');
  });

  it('gives a timed exercise a timer button rather than editable targets', async () => {
    stageSession();
    const { findByLabelText, queryByLabelText } = await render(<LiveScreen />);

    expect(await findByLabelText('Start timer for set 1 of Plank')).toBeTruthy();
    expect(queryByLabelText('Weight for set 1 of Plank')).toBeNull();
  });

  it('renders a distance exercise in metres', async () => {
    stageSession();
    const { findByLabelText } = await render(<LiveScreen />);

    expect((await findByLabelText('Distance for set 1 of Row Machine')).props.value).toBe('500');
  });

  it('shows an em dash for PREV, rather than inventing a previous performance', async () => {
    stageSession();
    const { findAllByText } = await render(<LiveScreen />);

    expect((await findAllByText('—')).length).toBeGreaterThan(0);
  });
});

/**
 * Fidelity against `screenshots/live workout.png` and `live workout 2.png`, which outrank the
 * prototype. Each case below pins an element that is plainly visible in one of them, so a later
 * refactor cannot quietly drop it.
 */
describe('design fidelity', () => {
  it('renders the "How to train this" card, naming the current lift and its goal', async () => {
    stageSession();
    const { findByText } = await render(<LiveScreen />);

    expect(await findByText('How to train this')).toBeTruthy();
    expect(await findByText('Bench Press · Strength')).toBeTruthy();
  });

  it('expands the guide to the goal table and badges the current lift', async () => {
    stageSession();
    const { findByLabelText, findByText, queryByText } = await render(<LiveScreen />);

    expect(queryByText('This lift')).toBeNull();

    await fireEvent.press(await findByLabelText('How to train this'));

    expect(await findByText('This lift')).toBeTruthy();
    // The design renders load, reps and rest as three separate elements -- load right-aligned
    // on the goal row, reps and rest as their own pills below it -- not one concatenated line.
    expect(await findByText('80–95% 1RM')).toBeTruthy();
    expect(await findByText('1–5 reps')).toBeTruthy();
    expect(await findByText('3–5 min rest')).toBeTruthy();
    expect(await findByText('Move heavy weight with excellent technique')).toBeTruthy();
    expect(await findByText('Hypertrophy')).toBeTruthy();
  });

  it('shows each exercise goal as a chip', async () => {
    stageSession();
    const { findAllByText, findByText } = await render(<LiveScreen />);

    // "Strength" appears both as the chip and inside the guide subtitle.
    expect((await findAllByText('Strength')).length).toBeGreaterThan(0);
    expect(await findByText('Weight · 2 sets')).toBeTruthy();
  });

  it('offers the history chart on each exercise', async () => {
    stageSession();
    const { findByLabelText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Open Bench Press history'));

    expect(mockPush).toHaveBeenCalledWith('/exercise/ex-1');
  });

  it('offers "Set as time" on a distance exercise only, and it switches the row', async () => {
    stageSession();
    const { findByLabelText, queryByLabelText } = await render(<LiveScreen />);

    expect(queryByLabelText('Set Bench Press as time')).toBeNull();

    await fireEvent.press(await findByLabelText('Set Row Machine as time'));

    // The row is now a timed set, so it gains a timer and loses its distance field.
    expect(await findByLabelText('Start timer for set 1 of Row Machine')).toBeTruthy();
    expect(queryByLabelText('Distance for set 1 of Row Machine')).toBeNull();
  });

  it('labels the unit pill by measure -- M for distance, KG otherwise', async () => {
    stageSession();
    const { findAllByText } = await render(<LiveScreen />);

    // The prototype gates the pill on `showUnitToggle: m !== 'time'` -- a plank has no unit to
    // switch between, so it gets none. Bench Press (KG) and Row Machine (M) each get one.
    expect((await findAllByText('KG')).length).toBe(1);
    expect((await findAllByText('M')).length).toBe(1);
  });

  it('keeps the Watch card honest rather than showing simulated bpm', async () => {
    stageSession();
    const { findByText, queryByText } = await render(<LiveScreen />);

    expect(await findByText('No watch connected')).toBeTruthy();
    expect(queryByText('bpm')).toBeNull();
  });
});

describe('logging a set', () => {
  it('writes set_completed and rest_started to the local log, in that order', async () => {
    stageSession();
    const { findByLabelText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Complete set 1 of Bench Press'));

    await waitFor(() => expect(appendSessionEvent).toHaveBeenCalledTimes(2));
    const types = (appendSessionEvent as jest.Mock).mock.calls.map((call) => call[2]);
    expect(types).toEqual(['set_completed', 'rest_started']);
  });

  it('records the values performed, not the template prescription', async () => {
    stageSession();
    const { findByLabelText } = await render(<LiveScreen />);

    await fireEvent.changeText(await findByLabelText('Weight for set 1 of Bench Press'), '82.5');
    await fireEvent.press(await findByLabelText('Complete set 1 of Bench Press'));

    await waitFor(() => expect(appendSessionEvent).toHaveBeenCalled());
    expect((appendSessionEvent as jest.Mock).mock.calls[0][4]).toMatchObject({
      exerciseId: 'ex-1',
      setIndex: 0,
      weightKg: 82.5,
      reps: 8,
    });
  });

  it('updates the counters and the volume once a set is ticked', async () => {
    stageSession();
    const { findByLabelText, findByText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Complete set 1 of Bench Press'));

    expect(await findByText('1/4 sets')).toBeTruthy();
    expect(await findByText('640 kg')).toBeTruthy();
  });

  it('pushes to the rest screen with the session rest length', async () => {
    stageSession();
    const { findByLabelText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Complete set 1 of Bench Press'));

    expect(mockPush).toHaveBeenCalledWith('/rest');
    expect(getRestContext()).toMatchObject({ seconds: 90, upNextName: 'Bench Press' });
  });

  it('opens the set timer for a timed set instead of ticking it', async () => {
    stageSession();
    const { findByLabelText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Start timer for set 1 of Plank'));

    expect(mockPush).toHaveBeenCalledWith('/set-timer');
    expect(getTimerContext()).toMatchObject({ exerciseIndex: 1, setIndex: 0, exerciseName: 'Plank', seconds: 45 });
    expect(appendSessionEvent).not.toHaveBeenCalled();
  });

  it('refuses an out-of-order tick and says so, without touching the log', async () => {
    stageSession();
    const { findByLabelText, findByText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Complete set 2 of Bench Press'));

    expect(await findByText('Complete set 1 first')).toBeTruthy();
    expect(appendSessionEvent).not.toHaveBeenCalled();
  });
});

describe('returning from the set timer', () => {
  it('ticks the set the timer finished, once, through the reducer', async () => {
    stageSession();
    setCompletedTimedSet({ exerciseIndex: 1, setIndex: 0 });

    const { findByText } = await render(<LiveScreen />);

    expect(await findByText('1/4 sets')).toBeTruthy();
    await waitFor(() => {
      const types = (appendSessionEvent as jest.Mock).mock.calls.map((call) => call[2]);
      expect(types).toEqual(['set_completed', 'exercise_completed', 'rest_started']);
    });
    // Plank's only set finished, so the exercise is done too -- and the payload carries the
    // duration held, not a weight.
    expect((appendSessionEvent as jest.Mock).mock.calls[0][4]).toMatchObject({
      exerciseId: 'ex-2',
      setIndex: 0,
      durationSeconds: 45,
    });
  });

  it('consumes the result, so a later focus cannot double-tick it', async () => {
    stageSession();
    setCompletedTimedSet({ exerciseIndex: 1, setIndex: 0 });
    await render(<LiveScreen />);

    expect(consumeCompletedTimedSet()).toBeNull();
  });
});

describe('the rest-timer card', () => {
  it('starts at the design default of 1:30', async () => {
    stageSession();
    const { findByText } = await render(<LiveScreen />);

    expect(await findByText('1:30')).toBeTruthy();
  });

  it('steps by fifteen seconds and carries into the next rest', async () => {
    stageSession();
    const { findByLabelText, findByText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Increase rest'));
    expect(await findByText('1:45')).toBeTruthy();

    await fireEvent.press(await findByLabelText('Complete set 1 of Bench Press'));
    expect(mockPush).toHaveBeenCalledWith('/rest');
    expect(getRestContext()?.seconds).toBe(105);
  });
});

describe('editing the session in flight', () => {
  /**
   * The unit chip is a button, not a label. Reported from a device: it looked tappable and did
   * nothing.
   *
   * What matters beyond the label flipping is that **no stored value changes**. Every weight is
   * kilograms in the log and on the wire (ADR-016); the chip changes the rendering only, so a
   * session logged in pounds must upload exactly the kilograms it always held.
   */
  describe('the unit chip', () => {
    it('switches one exercise between kg and lb, converting what is shown', async () => {
      stageSession();
      const { findByLabelText } = await render(<LiveScreen />);
      const weight = async () =>
        (await findByLabelText('Weight for set 1 of Bench Press')).props.value;

      expect(await weight()).toBe('80');

      await fireEvent.press(await findByLabelText('Switch Bench Press to lb'));

      // 80 kg is 176.37 lb, rounded to the nearest half pound.
      expect(await weight()).toBe('176.5');
    });

    it('switches back without the weight drifting', async () => {
      stageSession();
      const { findByLabelText } = await render(<LiveScreen />);

      await fireEvent.press(await findByLabelText('Switch Bench Press to lb'));
      await fireEvent.press(await findByLabelText('Switch Bench Press to kg'));

      expect((await findByLabelText('Weight for set 1 of Bench Press')).props.value).toBe('80');
    });

    /** Per exercise, not per app -- kilograms on the bar and pounds on the dumbbells. */
    it('leaves every other exercise alone', async () => {
      stageSession();
      const { findByLabelText, findByDisplayValue } = await render(<LiveScreen />);

      await fireEvent.press(await findByLabelText('Switch Bench Press to lb'));

      // Row Machine is a distance exercise and keeps its metres.
      expect(await findByDisplayValue('500')).toBeTruthy();
    });

    it('offers miles on a distance exercise rather than pounds', async () => {
      stageSession();
      const { findByLabelText, findByDisplayValue } = await render(<LiveScreen />);

      await fireEvent.press(await findByLabelText('Switch Row Machine to mi'));

      // 500 m is 0.31 miles.
      expect(await findByDisplayValue('0.31')).toBeTruthy();
    });

    /** A timed set has no unit to switch, so the chip is not drawn at all. */
    it('is absent on a timed exercise', async () => {
      stageSession();
      const { queryByLabelText } = await render(<LiveScreen />);

      await waitFor(() => expect(queryByLabelText('Switch Bench Press to lb')).toBeTruthy());
      expect(queryByLabelText('Switch Plank to lb')).toBeNull();
      expect(queryByLabelText('Switch Plank to kg')).toBeNull();
    });
  });

  it('adds a set to an exercise', async () => {
    stageSession();
    const { findByLabelText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Add set to Bench Press'));

    expect(await findByLabelText('Weight for set 3 of Bench Press')).toBeTruthy();
  });

  it('removes an exercise from this session', async () => {
    stageSession();
    const { findByLabelText, queryByText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Remove Bench Press'));

    await waitFor(() => expect(queryByText('Bench Press')).toBeNull());
  });

  it('routes Add exercise into the library in live pick mode', async () => {
    stageSession();
    const { findByLabelText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Add exercise'));

    expect(mockPush).toHaveBeenCalledWith('/library?pick=live');
  });
});

describe('the offline path', () => {
  /**
   * The proof `phase-3-plan.md` asks for by name. Every API function is mocked to reject at the
   * top of this file, so if any of them were on the critical path this test could not pass.
   */
  it('starts, logs and finishes a whole session with every API call rejecting', async () => {
    stageSession();
    const { findByLabelText, findByText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Complete set 1 of Bench Press'));
    await fireEvent.press(await findByLabelText('Complete set 2 of Bench Press'));
    await fireEvent.press(await findByLabelText('Complete set 1 of Row Machine'));

    expect(await findByText('3/4 sets')).toBeTruthy();

    await fireEvent.press(await findByLabelText('Finish workout'));

    await waitFor(() => {
      const types = (appendSessionEvent as jest.Mock).mock.calls.map((call) => call[2]);
      expect(types).toContain('workout_finished');
      expect(types).toContain('exercise_completed');
    });
    expect(mockReplace).toHaveBeenCalledWith('/workout-done');
    // The whole point of the offline path: the finished session reaches the sync queue even
    // though every API call rejected.
    await waitFor(() => expect(enqueueSessionUpload).toHaveBeenCalledTimes(1));
    const payload = (enqueueSessionUpload as jest.Mock).mock.calls[0][1];
    expect(payload).toMatchObject({ id: 'session-1', templateId: 'template-1', isLiveTracked: false });
    // Every set travels, ticked or not -- analytics filters on isCompleted rather than
    // assuming each row happened.
    expect(payload.exercises[0].sets).toHaveLength(2);
  });

  it('still runs the session when the local database cannot even be opened', async () => {
    (openWorkoutSessionDb as jest.Mock).mockRejectedValue(new Error('no such file'));
    stageSession();
    const { findByLabelText, findByText } = await render(<LiveScreen />);

    await fireEvent.press(await findByLabelText('Complete set 1 of Bench Press'));

    // Crash recovery is lost, but the workout itself must not be blocked on storage.
    expect(await findByText('1/4 sets')).toBeTruthy();
  });
});
