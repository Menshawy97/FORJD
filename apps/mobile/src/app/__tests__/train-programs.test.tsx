import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn() },
    useFocusEffect: (callback: () => void) => {
      react.useEffect(() => {
        callback();
      }, []);
    },
  };
});

jest.mock('@/auth/apiClient', () => ({
  getProgramEnrollment: jest.fn(),
  listPrograms: jest.fn(),
  listWorkoutTemplates: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  listWorkoutSessions: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getWorkoutSession: jest.fn(),
}));

jest.mock('@/store/exercise-catalogue', () => ({
  openExerciseCatalogueDb: jest.fn().mockResolvedValue({}),
  getCachedExercise: jest.fn().mockResolvedValue(null),
}));

import { getProgramEnrollment, listPrograms } from '@/auth/apiClient';

import TrainScreen from '../(tabs)/train';

const mockEnrollment = getProgramEnrollment as jest.MockedFunction<typeof getProgramEnrollment>;
const mockList = listPrograms as jest.MockedFunction<typeof listPrograms>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const enrollment = {
  enrollment: {
    id: 'enr-1',
    programId: 'program-1',
    programSlug: 'upper-lower',
    programName: 'Upper / Lower',
    programVersion: 1,
    startedAt: '2026-09-01T08:00:00.000Z',
  },
};

const myProgram = {
  id: 'mine-1',
  slug: 'my-split',
  name: 'My Split',
  category: 'strength' as const,
  level: 'beginner' as const,
  daysPerWeek: 3,
  durationWeeks: 6,
  description: null,
  isOwn: true,
  workoutCount: 3,
};

/**
 * Train's programs sections (Phase 3K5) — the hero that reaches the catalogue, the "Currently
 * following" chip, and "My programs".
 *
 * The hero's copy is the one thing here deliberately *not* the prototype's: it advertises nine
 * programs rather than "24 structured programs", because nine is what the app can actually back.
 * That correction was decided when Phase K was planned, and this pins it.
 */
describe('Train programs sections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnrollment.mockResolvedValue({ enrollment: null });
    mockList.mockResolvedValue({ items: [] });
  });

  it('advertises the number of programs the app can actually back, not the prototype 24', async () => {
    const { findByText, queryByText } = await render(<TrainScreen />);

    expect(
      await findByText('Nine structured programs — strength, hybrid, running, cross training'),
    ).toBeTruthy();
    expect(queryByText(/24 structured programs/)).toBeNull();
  });

  it('opens the catalogue from the hero', async () => {
    const { findByLabelText } = await render(<TrainScreen />);

    await fireEvent.press(await findByLabelText('Follow a Program'));

    expect(mockPush).toHaveBeenCalledWith('/programs');
  });

  /** The chip is the design's only indicator that a program is being followed. */
  it('shows the currently-following chip only while an enrolment is active', async () => {
    const { queryByText, findByLabelText } = await render(<TrainScreen />);

    await findByLabelText('Follow a Program');
    expect(queryByText(/Currently following/)).toBeNull();
  });

  it('names the followed program and opens it', async () => {
    mockEnrollment.mockResolvedValue(enrollment);
    const { findByLabelText } = await render(<TrainScreen />);

    await fireEvent.press(await findByLabelText('Currently following: Upper / Lower'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/program/[id]',
      params: { id: 'program-1' },
    });
  });

  /**
   * "My programs" asks for `mine`, never the presets — the catalogue is the hero's job. It renders
   * nothing at all when empty, as the prototype's own `progF.length ? … : null` does, which is why
   * it stays invisible until K6's builder can create one.
   */
  it('asks only for the athlete own programs', async () => {
    await render(<TrainScreen />);

    await waitFor(() => expect(mockList).toHaveBeenCalledWith({ scope: 'mine' }));
  });

  it('renders no My programs section when the athlete has none', async () => {
    const { queryByText, findByLabelText } = await render(<TrainScreen />);

    await findByLabelText('Follow a Program');
    expect(queryByText('My programs')).toBeNull();
  });

  it('lists the athlete own programs when there are some', async () => {
    mockList.mockResolvedValue({ items: [myProgram] });
    const { findByText, findByLabelText } = await render(<TrainScreen />);

    expect(await findByText('My programs')).toBeTruthy();
    expect(await findByText('3 days · 6 weeks')).toBeTruthy();

    await fireEvent.press(await findByLabelText('Open My Split'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/program/[id]', params: { id: 'mine-1' } });
  });

  /**
   * Train is the workout tab. Losing the network should cost the athlete a chip and a list, not
   * the ability to see the screen at all.
   */
  it('still renders when both program reads fail', async () => {
    mockEnrollment.mockRejectedValue(new Error('offline'));
    mockList.mockRejectedValue(new Error('offline'));

    const { findByLabelText } = await render(<TrainScreen />);

    expect(await findByLabelText('Follow a Program')).toBeTruthy();
  });
});
