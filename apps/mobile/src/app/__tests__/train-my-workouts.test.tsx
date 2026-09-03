// Phase 3J -- Train's "My workouts" list, matched against `train2.png`.
//
// This closes the gap the roadmap had carried since Phase G: the builder could save a workout
// but nothing in the app could list it back, so a saved workout was invisible. These tests pin
// that it appears, that its badge is derived correctly, and that the list refreshes on focus
// rather than only on mount -- returning from the builder having just saved must show it.
//
// NOTE: RTL v14 -- render() and every fireEvent.* return Promises and must be awaited.
import { AxiosError } from 'axios';
import { act, fireEvent, render as rtlRender } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
let mockFocusCallback: (() => void) | null = null;

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    useFocusEffect: (callback: () => void) => {
      mockFocusCallback = callback;
      react.useEffect(() => callback(), []);
    },
  };
});

jest.mock('@/auth/apiClient', () => ({
  listWorkoutTemplates: jest.fn(),
}));

import { listWorkoutTemplates } from '@/auth/apiClient';

import TrainScreen from '../(tabs)/train';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const template = (overrides: Record<string, unknown> = {}) => ({
  id: 'template-1',
  name: 'Upper Push — my version',
  activity: 'strength',
  estimatedDurationMinutes: 52,
  exerciseCount: 6,
  isCustom: true,
  basedOnTemplateId: 'preset-9',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallback = null;
  (listWorkoutTemplates as jest.Mock).mockResolvedValue({ items: [template()], nextCursor: null });
});

describe('the list', () => {
  it('shows a saved workout, which nothing in the app could do before', async () => {
    const { findByText } = await render(<TrainScreen />);

    expect(await findByText('My workouts')).toBeTruthy();
    expect(await findByText('Upper Push — my version')).toBeTruthy();
    expect(await findByText('6 exercises · ~52 min')).toBeTruthy();
  });

  it('omits the duration when the template has none', async () => {
    (listWorkoutTemplates as jest.Mock).mockResolvedValue({
      items: [template({ estimatedDurationMinutes: null })],
      nextCursor: null,
    });

    const { findByText } = await render(<TrainScreen />);

    expect(await findByText('6 exercises')).toBeTruthy();
  });

  it('derives the badge from isCustom and basedOnTemplateId, the two booleans that exist', async () => {
    (listWorkoutTemplates as jest.Mock).mockResolvedValue({
      items: [
        template({ id: 't1', name: 'A', isCustom: true, basedOnTemplateId: 'preset-9' }),
        template({ id: 't2', name: 'B', isCustom: true, basedOnTemplateId: null }),
        template({ id: 't3', name: 'C', isCustom: false, basedOnTemplateId: null }),
      ],
      nextCursor: null,
    });

    const { findByText } = await render(<TrainScreen />);

    expect(await findByText('Customised preset')).toBeTruthy();
    expect(await findByText('Custom')).toBeTruthy();
    expect(await findByText('Preset')).toBeTruthy();
  });

  it('invites a first workout rather than showing an empty list', async () => {
    (listWorkoutTemplates as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });

    const { findByText } = await render(<TrainScreen />);

    expect(await findByText('No workouts yet. Tap + to build your first.')).toBeTruthy();
  });

  it('reloads on focus, so a workout just saved in the builder appears on return', async () => {
    const { findByText } = await render(<TrainScreen />);
    await findByText('Upper Push — my version');

    // The builder saves and calls router.back(); this screen regains focus with a new template
    // on the server that a mount-only effect would never fetch.
    (listWorkoutTemplates as jest.Mock).mockResolvedValue({
      items: [template({ id: 't2', name: 'Saturday Conditioning' })],
      nextCursor: null,
    });
    await act(async () => {
      mockFocusCallback?.();
    });

    expect(await findByText('Saturday Conditioning')).toBeTruthy();
  });
});

describe('failures', () => {
  it('tells an offline user to check their connection', async () => {
    (listWorkoutTemplates as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const { findByText } = await render(<TrainScreen />);

    expect(await findByText('Cannot reach FORJD. Check your connection and try again.')).toBeTruthy();
  });

  it('shows generic copy for a server failure', async () => {
    const rejection = new AxiosError('Server Error');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rejection as any).response = { status: 500, data: { message: 'Internal server error' } };
    (listWorkoutTemplates as jest.Mock).mockRejectedValue(rejection);

    const { findByText } = await render(<TrainScreen />);

    expect(await findByText('Could not load your workouts.')).toBeTruthy();
  });
});

describe('navigation', () => {
  it('opens a workout from its row', async () => {
    const { findByLabelText } = await render(<TrainScreen />);

    await fireEvent.press(await findByLabelText('Open Upper Push — my version'));

    expect(mockPush).toHaveBeenCalledWith('/workout/template-1');
  });

  it('starts a workout from its Start link', async () => {
    const { findByLabelText } = await render(<TrainScreen />);

    await fireEvent.press(await findByLabelText('Start Upper Push — my version'));

    expect(mockPush).toHaveBeenCalledWith('/workout/template-1');
  });

  it('offers both routes into the builder', async () => {
    const { findByLabelText } = await render(<TrainScreen />);

    await fireEvent.press(await findByLabelText('New workout link'));
    expect(mockPush).toHaveBeenCalledWith('/builder');

    await fireEvent.press(await findByLabelText('New workout'));
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it('keeps the exercise library quick action working', async () => {
    const { findByLabelText } = await render(<TrainScreen />);

    await fireEvent.press(await findByLabelText('Exercise library'));

    expect(mockPush).toHaveBeenCalledWith('/library');
  });
});
