import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    replace: jest.fn(),
  },
}));

jest.mock('@/auth/apiClient', () => ({ listPrograms: jest.fn() }));

import { listPrograms } from '@/auth/apiClient';

import ProgramsScreen from '../programs';

const mockList = listPrograms as jest.MockedFunction<typeof listPrograms>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const upperLower = {
  id: '3f1a4d64-6b2f-4d0e-9d0a-3c2f9a5e1b77',
  slug: 'upper-lower',
  name: 'Upper / Lower',
  category: 'strength' as const,
  level: 'intermediate' as const,
  daysPerWeek: 4,
  durationWeeks: 8,
  description: 'Balanced strength for 3–5 sessions a week',
  isOwn: false,
  workoutCount: 4,
};

/**
 * The catalogue. What matters beyond rendering is the `scope`: this screen must never show a
 * program the athlete built, which is the whole reason the server defaults `scope` to `preset`.
 */
describe('ProgramsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValue({ items: [upperLower] });
  });

  it('lists programs with the design meta line assembled client-side', async () => {
    const { findByText } = await render(<ProgramsScreen />);

    expect(await findByText('Upper / Lower')).toBeTruthy();
    expect(await findByText('4 days · 8 weeks')).toBeTruthy();
    expect(await findByText('Intermediate')).toBeTruthy();
  });

  /** A custom program appearing here is the failure the scope parameter exists to prevent. */
  it('always asks for presets, never a mixed list', async () => {
    await render(<ProgramsScreen />);

    await waitFor(() => expect(mockList).toHaveBeenCalledWith({ scope: 'preset' }));
  });

  it('filters by category, keeping the preset scope', async () => {
    const { findByLabelText } = await render(<ProgramsScreen />);

    await fireEvent.press(await findByLabelText('Show Running programs'));

    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith({ scope: 'preset', category: 'running' }),
    );
  });

  /**
   * Favourites has no backing anywhere in this system, and a chip that always showed an empty
   * list would be worse than one that is not there.
   */
  it('does not offer a Favourites chip it cannot fill', async () => {
    const { queryByLabelText, findByLabelText } = await render(<ProgramsScreen />);

    await findByLabelText('Show All programs');
    expect(queryByLabelText('Show Favourites programs')).toBeNull();
  });

  it('opens a program overview when a row is tapped', async () => {
    const { findByLabelText } = await render(<ProgramsScreen />);

    await fireEvent.press(await findByLabelText('Open Upper / Lower'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/program/[id]',
      params: { id: upperLower.id },
    });
  });

  /** Filtering to an empty category is a real state, not a spinner that never resolves. */
  it('says so when a category has no programs', async () => {
    mockList.mockResolvedValue({ items: [] });
    const { findByText } = await render(<ProgramsScreen />);

    expect(await findByText('No programs in this category yet.')).toBeTruthy();
  });

  it('surfaces a load failure rather than showing an empty catalogue', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    const { findByText } = await render(<ProgramsScreen />);

    expect(await findByText('Could not load programs. Please try again.')).toBeTruthy();
  });
});
