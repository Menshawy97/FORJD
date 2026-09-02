// NOTE: @testing-library/react-native v14 made render() and every fireEvent.* async --
// each returns a Promise and MUST be awaited. An un-awaited one leaves an open act() scope
// that silently empties the rendered tree for every LATER test in the file, which presents
// as "unable to find an element" on tests that pass in isolation. Await everything.
//
// Phase 3G's deferred component tests, written after the screen shipped and after a physical
// device walk found three UI bugs in it that Jest could not have caught (badge colour, spacing,
// save-error copy). These cover the four behaviours that *are* testable here and that a
// refactor could silently break: the save flow's request body, the ordered validation message,
// the picked-exercise handoff from `library.tsx?pick=builder`, and the Customise prefill from
// `workout/[id].tsx`.
//
// `@/workouts/builder-handoff` is deliberately NOT mocked. It is a plain in-memory module with
// no I/O, and the handoff *is* the thing under test in two of these cases -- mocking it would
// leave the real set/consume pairing (and its "consume exactly once" contract) unexercised,
// which is precisely where a regression would hide.
import { AxiosError } from 'axios';
import { act, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockBack = jest.fn();
const mockPush = jest.fn();

// The builder reads its picked exercise inside `useFocusEffect`. The callback is captured on
// render so a test can fire a *second* focus (`refocus()`), which is how the "a pick is
// consumed once, never re-applied" and "a prefill is not re-applied" cases are expressed --
// both are real bugs the screen's own comments say it is guarding against.
let mockFocusCallback: (() => void) | null = null;
jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: {
      back: (...args: unknown[]) => mockBack(...args),
      push: (...args: unknown[]) => mockPush(...args),
    },
    useFocusEffect: (callback: () => void) => {
      mockFocusCallback = callback;
      react.useEffect(() => {
        callback();
      }, []);
    },
  };
});

jest.mock('@/auth/apiClient', () => ({
  createWorkoutTemplate: jest.fn(),
}));

import { createWorkoutTemplate } from '@/auth/apiClient';
import {
  setBuilderPrefill,
  setPickedExerciseForBuilder,
  consumeBuilderPrefill,
  consumePickedExerciseForBuilder,
} from '@/workouts/builder-handoff';

import BuilderScreen from '../builder';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

async function refocus() {
  // Must be awaited: an un-awaited act() leaves React mid-batch and every later render
  // in this file silently loses its tree (found the hard way -- the symptom was every
  // subsequent test failing to find elements that were plainly there).
  await act(async () => {
    mockFocusCallback?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallback = null;
  // The handoff module is real, so its module-level slots survive between tests in the same
  // file. Draining both keeps each case independent.
  consumeBuilderPrefill();
  consumePickedExerciseForBuilder();
  (createWorkoutTemplate as jest.Mock).mockResolvedValue({ id: 'template-1' });
});

describe('picked-exercise handoff', () => {
  it('adds the exercise the library picked, with the defaults for its measure', async () => {
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });

    const { getByText, getAllByText } = await render(<BuilderScreen />);

    expect(getByText('Bench Press')).toBeTruthy();
    expect(getByText('Reps')).toBeTruthy();
    // 3 sets and 10 reps are the screen's own defaults for a weight-measured exercise.
    expect(getAllByText('3').length).toBeGreaterThan(0);
    expect(getByText('10')).toBeTruthy();
  });

  it('labels the second stepper by the exercise measure, not always reps', async () => {
    setPickedExerciseForBuilder({ exerciseId: 'ex-2', name: 'Plank', measure: 'time' });

    const { getByText, queryByText, getByLabelText } = await render(<BuilderScreen />);

    expect(getByText('Duration (s)')).toBeTruthy();
    expect(getByText('45')).toBeTruthy();
    expect(queryByText('Reps')).toBeNull();
    // The stepper must ANNOUNCE what it visibly says. Before this was fixed it announced the
    // domain display name ('Increase time' / 'Increase weight x reps') instead.
    expect(getByLabelText('Increase duration (s)')).toBeTruthy();
    expect(getByLabelText('Decrease duration (s)')).toBeTruthy();
  });

  it('consumes a pick exactly once, so returning to the screen does not duplicate it', async () => {
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });

    const { getAllByText } = await render(<BuilderScreen />);
    expect(getAllByText('Bench Press')).toHaveLength(1);

    await refocus();

    expect(getAllByText('Bench Press')).toHaveLength(1);
  });

  it('routes Add exercise into the library in builder pick mode', async () => {
    const { getByLabelText } = await render(<BuilderScreen />);

    await fireEvent.press(getByLabelText('Add exercise'));

    expect(mockPush).toHaveBeenCalledWith('/library?pick=builder');
  });
});

describe('validation message', () => {
  it('says nothing until the user actually tries to save', async () => {
    const { queryByText } = await render(<BuilderScreen />);

    expect(queryByText(/before saving/)).toBeNull();
  });

  it('asks for both when the form is empty, and does not call the API', async () => {
    const { getByLabelText, findByText } = await render(<BuilderScreen />);

    await fireEvent.press(getByLabelText('Save workout'));

    expect(await findByText('Add a name and at least one exercise before saving or starting.')).toBeTruthy();
    expect(createWorkoutTemplate).not.toHaveBeenCalled();
  });

  it('asks only for a name when exercises are already added', async () => {
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });
    const { getByLabelText, findByText } = await render(<BuilderScreen />);

    await fireEvent.press(getByLabelText('Save workout'));

    expect(await findByText('Give this workout a name before saving.')).toBeTruthy();
  });

  it('asks only for an exercise when a name is already typed', async () => {
    const { getByLabelText, findByText } = await render(<BuilderScreen />);

    await fireEvent.changeText(getByLabelText('Workout name'), 'Push day');
    await fireEvent.press(getByLabelText('Save workout'));

    expect(await findByText('Add at least one exercise before saving or starting.')).toBeTruthy();
  });

  it('treats whitespace as no name at all', async () => {
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });
    const { getByLabelText, findByText } = await render(<BuilderScreen />);

    await fireEvent.changeText(getByLabelText('Workout name'), '   ');
    await fireEvent.press(getByLabelText('Save workout'));

    expect(await findByText('Give this workout a name before saving.')).toBeTruthy();
    expect(createWorkoutTemplate).not.toHaveBeenCalled();
  });
});

describe('save flow', () => {
  it('posts one straight-sets block with the edited targets, then returns', async () => {
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });
    const { getByLabelText } = await render(<BuilderScreen />);

    await fireEvent.changeText(getByLabelText('Workout name'), '  Push day  ');
    await fireEvent.press(getByLabelText('Increase sets'));
    await fireEvent.press(getByLabelText('Increase reps'));
    await fireEvent.press(getByLabelText('Save workout'));

    await waitFor(() => expect(createWorkoutTemplate).toHaveBeenCalledTimes(1));
    expect(createWorkoutTemplate).toHaveBeenCalledWith({
      name: 'Push day',
      activity: 'strength',
      blocks: [
        {
          type: 'straight_sets',
          exercises: [
            {
              exerciseId: 'ex-1',
              setCount: 4,
              targetReps: 11,
              targetSeconds: undefined,
              targetDistanceMeters: undefined,
            },
          ],
        },
      ],
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });

  it('omits basedOnTemplateId entirely when the workout was built from scratch', async () => {
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });
    const { getByLabelText } = await render(<BuilderScreen />);

    await fireEvent.changeText(getByLabelText('Workout name'), 'Push day');
    await fireEvent.press(getByLabelText('Save workout'));

    await waitFor(() => expect(createWorkoutTemplate).toHaveBeenCalled());
    const body = (createWorkoutTemplate as jest.Mock).mock.calls[0][0];
    expect(body).not.toHaveProperty('basedOnTemplateId');
  });

  it('drops a removed exercise from the request', async () => {
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });
    const { getByLabelText, findByText, queryByText } = await render(<BuilderScreen />);

    await fireEvent.press(getByLabelText('Remove Bench Press'));
    expect(queryByText('Bench Press')).toBeNull();

    await fireEvent.changeText(getByLabelText('Workout name'), 'Push day');
    await fireEvent.press(getByLabelText('Save workout'));

    // Name present but no exercises left -- the validation gate catches it, rather than a
    // request going out with an empty block for the API to reject.
    expect(createWorkoutTemplate).not.toHaveBeenCalled();
    expect(await findByText('Add at least one exercise before saving or starting.')).toBeTruthy();
  });

  it('never lets a stepper go below one', async () => {
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });
    const { getByLabelText, getAllByText } = await render(<BuilderScreen />);

    for (let i = 0; i < 5; i += 1) {
      await fireEvent.press(getByLabelText('Decrease sets'));
    }

    await waitFor(() => expect(getAllByText('1').length).toBeGreaterThan(0));
  });
});

describe('save failures', () => {
  it('tells an offline user to check their connection, and does not navigate away', async () => {
    (createWorkoutTemplate as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });
    const { getByLabelText, findByText } = await render(<BuilderScreen />);

    await fireEvent.changeText(getByLabelText('Workout name'), 'Push day');
    await fireEvent.press(getByLabelText('Save workout'));

    expect(await findByText('Cannot reach FORJD. Check your connection and try again.')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("shows the server's own message for a 400 rather than generic advice", async () => {
    const rejection = new AxiosError('Bad Request');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rejection as any).response = { status: 400, data: { message: 'A workout needs at least one exercise.' } };
    (createWorkoutTemplate as jest.Mock).mockRejectedValue(rejection);
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });
    const { getByLabelText, findByText } = await render(<BuilderScreen />);

    await fireEvent.changeText(getByLabelText('Workout name'), 'Push day');
    await fireEvent.press(getByLabelText('Save workout'));

    expect(await findByText('A workout needs at least one exercise.')).toBeTruthy();
  });

  it('falls back to generic copy for a status with no user-facing body', async () => {
    const rejection = new AxiosError('Server Error');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rejection as any).response = { status: 500, data: { message: 'Internal server error' } };
    (createWorkoutTemplate as jest.Mock).mockRejectedValue(rejection);
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });
    const { getByLabelText, findByText } = await render(<BuilderScreen />);

    await fireEvent.changeText(getByLabelText('Workout name'), 'Push day');
    await fireEvent.press(getByLabelText('Save workout'));

    expect(await findByText('Could not save this workout. Please try again.')).toBeTruthy();
  });

  it('re-enables the save button after a failure so the user can retry', async () => {
    (createWorkoutTemplate as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));
    setPickedExerciseForBuilder({ exerciseId: 'ex-1', name: 'Bench Press', measure: 'weight' });
    const { getByLabelText, findByText, getByText } = await render(<BuilderScreen />);

    await fireEvent.changeText(getByLabelText('Workout name'), 'Push day');
    await fireEvent.press(getByLabelText('Save workout'));
    await findByText('Cannot reach FORJD. Check your connection and try again.');

    expect(getByText('Save workout')).toBeTruthy();

    (createWorkoutTemplate as jest.Mock).mockResolvedValue({ id: 'template-1' });
    await fireEvent.press(getByLabelText('Save workout'));

    await waitFor(() => expect(createWorkoutTemplate).toHaveBeenCalledTimes(2));
  });
});

describe('Customise prefill', () => {
  const prefill = {
    basedOnTemplateId: 'preset-9',
    name: 'Upper / Lower',
    activity: 'strength' as const,
    exercises: [
      {
        exerciseId: 'ex-1',
        name: 'Bench Press',
        measure: 'weight' as const,
        setCount: 4,
        targetReps: 8,
        targetSeconds: null,
        targetDistanceMeters: null,
      },
      {
        exerciseId: 'ex-2',
        name: 'Barbell Row',
        measure: 'weight' as const,
        setCount: 3,
        targetReps: 12,
        targetSeconds: null,
        targetDistanceMeters: null,
      },
    ],
  };

  it('opens with the source template already filled in', async () => {
    setBuilderPrefill(prefill);

    const { getByLabelText, getByText } = await render(<BuilderScreen />);

    expect(getByLabelText('Workout name').props.value).toBe('Upper / Lower');
    expect(getByText('Bench Press')).toBeTruthy();
    expect(getByText('Barbell Row')).toBeTruthy();
  });

  it('badges the workout as a customised preset, not a from-scratch custom one', async () => {
    setBuilderPrefill(prefill);

    const { getByText, queryByText } = await render(<BuilderScreen />);

    expect(getByText('Customised preset')).toBeTruthy();
    expect(getByText('Based on a preset')).toBeTruthy();
    expect(queryByText('Built from scratch')).toBeNull();
  });

  it('badges a from-scratch workout as custom', async () => {
    const { getByText } = await render(<BuilderScreen />);

    expect(getByText('Custom')).toBeTruthy();
    expect(getByText('Built from scratch')).toBeTruthy();
  });

  it('carries basedOnTemplateId through to the create request', async () => {
    setBuilderPrefill(prefill);
    const { getByLabelText } = await render(<BuilderScreen />);

    await fireEvent.press(getByLabelText('Save workout'));

    await waitFor(() => expect(createWorkoutTemplate).toHaveBeenCalled());
    const body = (createWorkoutTemplate as jest.Mock).mock.calls[0][0];
    expect(body.basedOnTemplateId).toBe('preset-9');
    expect(body.name).toBe('Upper / Lower');
    expect(body.blocks[0].exercises).toEqual([
      { exerciseId: 'ex-1', setCount: 4, targetReps: 8, targetSeconds: undefined, targetDistanceMeters: undefined },
      { exerciseId: 'ex-2', setCount: 3, targetReps: 12, targetSeconds: undefined, targetDistanceMeters: undefined },
    ]);
  });

  it('drains the prefill slot on mount, so a second builder visit starts empty', async () => {
    setBuilderPrefill(prefill);
    await render(<BuilderScreen />);

    // The real once-only guarantee: the handoff slot is empty after the screen has taken it.
    expect(consumeBuilderPrefill()).toBeNull();
  });

  it('keeps the user edits when an unrelated focus event fires', async () => {
    setBuilderPrefill(prefill);
    const { getByLabelText, getAllByText } = await render(<BuilderScreen />);

    await fireEvent.press(getByLabelText('Remove Bench Press'));
    await fireEvent.changeText(getByLabelText('Workout name'), 'Upper / Lower v2');

    await refocus();

    expect(getByLabelText('Workout name').props.value).toBe('Upper / Lower v2');
    expect(getAllByText('Barbell Row')).toHaveLength(1);
  });
});
