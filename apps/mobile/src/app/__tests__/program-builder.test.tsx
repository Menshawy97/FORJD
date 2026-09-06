// Phase 3K6's `s_programBuilder()`. Mirrors `builder.test.tsx`'s conventions: every
// render()/fireEvent.* is awaited (RTL v14 makes both async), and `expo-router` is a hand-rolled
// mock that also exposes `useFocusEffect`'s captured callback for `refocus()`.
import { AxiosError } from 'axios';
import { act, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockBack = jest.fn();
const mockPush = jest.fn();

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
  createProgram: jest.fn(),
  listWorkoutTemplates: jest.fn(),
}));

import { createProgram, listWorkoutTemplates } from '@/auth/apiClient';

import ProgramBuilderScreen from '../program-builder';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

async function refocus() {
  await act(async () => {
    mockFocusCallback?.();
  });
}

const PRESET = { id: 'preset-1', name: 'Preset Bench Day', isCustom: false };
const OWN_A = { id: 'own-1', name: 'Push Day', isCustom: true };
const OWN_B = { id: 'own-2', name: 'Pull Day', isCustom: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallback = null;
  (listWorkoutTemplates as jest.Mock).mockResolvedValue({ items: [PRESET, OWN_A, OWN_B] });
  (createProgram as jest.Mock).mockResolvedValue({ id: 'program-1' });
});

describe('day pickers', () => {
  it('offers only the athlete own workouts, never a preset', async () => {
    const { findAllByText, queryByText } = await render(<ProgramBuilderScreen />);

    // Every one of the 7 unassigned days offers the same two own-workout chips.
    expect((await findAllByText('Push Day')).length).toBe(7);
    expect(queryByText('Preset Bench Day')).toBeNull();
  });

  it('reloads My Workouts on refocus, so a workout built via + New appears', async () => {
    const { findAllByText } = await render(<ProgramBuilderScreen />);
    await findAllByText('Push Day');

    const THIRD = { id: 'own-3', name: 'Leg Day', isCustom: true };
    (listWorkoutTemplates as jest.Mock).mockResolvedValue({ items: [PRESET, OWN_A, OWN_B, THIRD] });
    await refocus();

    expect((await findAllByText('Leg Day')).length).toBe(7);
  });

  it('opens the workout builder from + New', async () => {
    const { findByLabelText } = await render(<ProgramBuilderScreen />);

    await fireEvent.press(await findByLabelText('Build a new workout for Mon'));

    expect(mockPush).toHaveBeenCalledWith('/builder');
  });
});

describe('assigning a day', () => {
  it('shows the assigned workout name and removes that day from the picker chips', async () => {
    const { findByLabelText, findAllByText } = await render(<ProgramBuilderScreen />);

    await fireEvent.press(await findByLabelText('Assign Push Day to Mon'));

    // Mon now shows the assignment instead of its picker chips; the other 6 days still offer it.
    expect((await findAllByText('Push Day')).length).toBe(7);
    expect((await findAllByText('Pull Day')).length).toBe(6);
  });

  it('marks a day as a rest day, and can be removed again', async () => {
    // "Rest day" is both the unassigned link's own text and the assigned state's text (matching
    // the prototype), so every one of the 7 days already shows it -- assertions go through the
    // per-day accessibility labels instead, which stay unique.
    const { findByLabelText, queryByLabelText } = await render(<ProgramBuilderScreen />);

    await fireEvent.press(await findByLabelText('Mark Tue a rest day'));
    expect(await findByLabelText("Remove Tue's assignment")).toBeTruthy();
    expect(queryByLabelText('Mark Tue a rest day')).toBeNull();

    await fireEvent.press(await findByLabelText("Remove Tue's assignment"));
    expect(await findByLabelText('Mark Tue a rest day')).toBeTruthy();
  });
});

describe('validation', () => {
  it('says nothing until Save Program is pressed', async () => {
    const { queryByText } = await render(<ProgramBuilderScreen />);
    expect(queryByText(/before saving/)).toBeNull();
  });

  it('refuses to save with no name and no assigned day', async () => {
    const { findByLabelText, findByText } = await render(<ProgramBuilderScreen />);

    await fireEvent.press(await findByLabelText('Save Program'));

    expect(await findByText('Name it and assign at least one workout before saving.')).toBeTruthy();
    expect(createProgram).not.toHaveBeenCalled();
  });

  it('refuses a program with a name but nothing assigned', async () => {
    const { getByLabelText, findByLabelText, findByText } = await render(<ProgramBuilderScreen />);

    fireEvent.changeText(getByLabelText('Program name'), 'Off-season block');
    await fireEvent.press(await findByLabelText('Save Program'));

    expect(await findByText('Name it and assign at least one workout before saving.')).toBeTruthy();
  });
});

describe('save flow', () => {
  it('posts one workout per assigned day, using JS weekday indices, and returns', async () => {
    const { getByLabelText, findByLabelText } = await render(<ProgramBuilderScreen />);

    fireEvent.changeText(getByLabelText('Program name'), '  Off-season block  ');
    await fireEvent.press(await findByLabelText('Assign Push Day to Mon'));
    await fireEvent.press(await findByLabelText('Assign Pull Day to Wed'));
    await fireEvent.press(await findByLabelText('Save Program'));

    await waitFor(() => expect(createProgram).toHaveBeenCalledTimes(1));
    expect(createProgram).toHaveBeenCalledWith({
      name: 'Off-season block',
      durationWeeks: 4,
      workouts: [
        { templateId: 'own-1', dayOfWeek: 1 },
        { templateId: 'own-2', dayOfWeek: 3 },
      ],
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });

  it('never sends a rest day as a workout', async () => {
    const { getByLabelText, findByLabelText } = await render(<ProgramBuilderScreen />);

    fireEvent.changeText(getByLabelText('Program name'), 'Off-season block');
    await fireEvent.press(await findByLabelText('Assign Push Day to Mon'));
    await fireEvent.press(await findByLabelText('Mark Tue a rest day'));
    await fireEvent.press(await findByLabelText('Save Program'));

    await waitFor(() => expect(createProgram).toHaveBeenCalled());
    const body = (createProgram as jest.Mock).mock.calls[0][0];
    expect(body.workouts).toHaveLength(1);
  });

  it('sends the stepped week count', async () => {
    const { getByLabelText, findByLabelText } = await render(<ProgramBuilderScreen />);

    fireEvent.changeText(getByLabelText('Program name'), 'Off-season block');
    await fireEvent.press(await findByLabelText('Assign Push Day to Mon'));
    await fireEvent.press(getByLabelText('Increase weeks'));
    await fireEvent.press(getByLabelText('Increase weeks'));
    await fireEvent.press(await findByLabelText('Save Program'));

    await waitFor(() => expect(createProgram).toHaveBeenCalled());
    expect((createProgram as jest.Mock).mock.calls[0][0].durationWeeks).toBe(6);
  });

  it('never lets the week count go below one', async () => {
    const { getByLabelText, findByText } = await render(<ProgramBuilderScreen />);

    for (let i = 0; i < 5; i += 1) {
      await fireEvent.press(getByLabelText('Decrease weeks'));
    }

    expect(await findByText('1 weeks')).toBeTruthy();
  });
});

describe('save failures', () => {
  it('tells an offline user to check their connection, and does not navigate away', async () => {
    (createProgram as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));
    const { getByLabelText, findByLabelText, findByText } = await render(<ProgramBuilderScreen />);

    fireEvent.changeText(getByLabelText('Program name'), 'Off-season block');
    await fireEvent.press(await findByLabelText('Assign Push Day to Mon'));
    await fireEvent.press(await findByLabelText('Save Program'));

    expect(await findByText('Cannot reach FORJD. Check your connection and try again.')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("shows the server's own message for a 400 rather than generic advice", async () => {
    const rejection = new AxiosError('Bad Request');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rejection as any).response = { status: 400, data: { message: 'One or more workouts could not be found' } };
    (createProgram as jest.Mock).mockRejectedValue(rejection);
    const { getByLabelText, findByLabelText, findByText } = await render(<ProgramBuilderScreen />);

    fireEvent.changeText(getByLabelText('Program name'), 'Off-season block');
    await fireEvent.press(await findByLabelText('Assign Push Day to Mon'));
    await fireEvent.press(await findByLabelText('Save Program'));

    expect(await findByText('One or more workouts could not be found')).toBeTruthy();
  });
});
