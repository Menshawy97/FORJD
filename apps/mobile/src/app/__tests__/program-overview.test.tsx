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
  useLocalSearchParams: () => ({ id: 'program-1' }),
}));

jest.mock('@/auth/apiClient', () => ({
  getProgram: jest.fn(),
  getProgramEnrollment: jest.fn(),
  listWorkoutSessions: jest.fn(),
  enrolInProgram: jest.fn(),
  stopFollowingProgram: jest.fn(),
}));

import {
  enrolInProgram,
  getProgram,
  getProgramEnrollment,
  listWorkoutSessions,
  stopFollowingProgram,
} from '@/auth/apiClient';

import ProgramOverviewScreen from '../program/[id]';

const mockGet = getProgram as jest.MockedFunction<typeof getProgram>;
const mockEnrollment = getProgramEnrollment as jest.MockedFunction<typeof getProgramEnrollment>;
const mockSessions = listWorkoutSessions as jest.MockedFunction<typeof listWorkoutSessions>;
const mockEnrol = enrolInProgram as jest.MockedFunction<typeof enrolInProgram>;
const mockStop = stopFollowingProgram as jest.MockedFunction<typeof stopFollowingProgram>;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const program = {
  id: 'program-1',
  slug: 'upper-lower',
  name: 'Upper / Lower',
  category: 'strength' as const,
  level: 'intermediate' as const,
  daysPerWeek: 4,
  durationWeeks: 8,
  description: 'Balanced strength for 3–5 sessions a week',
  isOwn: false,
  workoutCount: 2,
  version: 1,
  workouts: [
    {
      templateId: 'tpl-a',
      name: 'Upper Body A',
      activity: 'strength' as const,
      orderIndex: 0,
      dayOfWeek: null,
      exerciseNames: ['Bench Press', 'Barbell Row'],
    },
    {
      templateId: 'tpl-b',
      name: 'Lower Body A',
      activity: 'strength' as const,
      orderIndex: 1,
      dayOfWeek: null,
      exerciseNames: ['Back Squat'],
    },
  ],
};

const activeEnrollment = {
  enrollment: {
    id: 'enr-1',
    programId: 'program-1',
    programSlug: 'upper-lower',
    programName: 'Upper / Lower',
    programVersion: 1,
    startedAt: '2026-09-01T08:00:00.000Z',
  },
};

const session = (name: string, startedAt: string) => ({
  id: `s-${name}-${startedAt}`,
  name,
  activity: 'strength' as const,
  status: 'completed' as const,
  startedAt,
  endedAt: startedAt,
  durationSeconds: 3600,
  perceivedEffort: 'solid' as const,
});

/**
 * The overview, against `screenshots/program.png`.
 *
 * The load-bearing behaviour is "Recommended next": the first workout not performed since
 * enrolling. It is derived from sessions and matched by name, because the session list carries no
 * template id — so it has to be right, and it must not appear at all when nothing is followed.
 */
describe('ProgramOverviewScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue(program);
    mockEnrollment.mockResolvedValue({ enrollment: null });
    mockSessions.mockResolvedValue({ items: [], nextCursor: null });
    mockEnrol.mockResolvedValue(activeEnrollment);
    mockStop.mockResolvedValue(undefined);
  });

  it('shows the program with its meta line, level and workouts', async () => {
    const { findByText } = await render(<ProgramOverviewScreen />);

    expect(await findByText('4 days · 8 weeks')).toBeTruthy();
    expect(await findByText('Intermediate')).toBeTruthy();
    expect(await findByText('Upper Body A')).toBeTruthy();
    expect(await findByText('Bench Press · Barbell Row')).toBeTruthy();
  });

  it('offers Start Following when nothing is being followed', async () => {
    const { findByLabelText, queryByLabelText } = await render(<ProgramOverviewScreen />);

    expect(await findByLabelText('Start Following')).toBeTruthy();
    expect(queryByLabelText('Stop Following')).toBeNull();
  });

  /** No enrolment means no progress through the program, so no recommendation. */
  it('shows no recommendation while the athlete is not following', async () => {
    const { findByText, queryByText } = await render(<ProgramOverviewScreen />);

    await findByText('Upper Body A');
    expect(queryByText('Recommended next')).toBeNull();
  });

  it('recommends the first workout not performed since enrolling', async () => {
    mockEnrollment.mockResolvedValue(activeEnrollment);
    mockSessions.mockResolvedValue({
      items: [session('Upper Body A', '2026-09-02T09:00:00.000Z')],
      nextCursor: null,
    });

    const { findByText, findAllByText } = await render(<ProgramOverviewScreen />);

    await findByText('Lower Body A');
    // Exactly one recommendation, and it is not the workout already done.
    expect((await findAllByText('Recommended next')).length).toBe(1);
  });

  /** A session performed before enrolling belongs to a previous attempt, not this one. */
  it('ignores sessions performed before the enrolment started', async () => {
    mockEnrollment.mockResolvedValue(activeEnrollment);
    mockSessions.mockResolvedValue({
      items: [session('Upper Body A', '2026-08-20T09:00:00.000Z')],
      nextCursor: null,
    });

    const { findAllByText } = await render(<ProgramOverviewScreen />);

    // Upper Body A is still the recommendation, because that session predates enrolling.
    expect((await findAllByText('Recommended next')).length).toBe(1);
  });

  it('follows the program and switches the button', async () => {
    const { findByLabelText } = await render(<ProgramOverviewScreen />);

    mockEnrollment.mockResolvedValue(activeEnrollment);
    await fireEvent.press(await findByLabelText('Start Following'));

    await waitFor(() => expect(mockEnrol).toHaveBeenCalledWith('program-1'));
    expect(await findByLabelText('Stop Following')).toBeTruthy();
  });

  it('stops following and switches back', async () => {
    mockEnrollment.mockResolvedValue(activeEnrollment);
    const { findByLabelText } = await render(<ProgramOverviewScreen />);

    await fireEvent.press(await findByLabelText('Stop Following'));

    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    expect(await findByLabelText('Start Following')).toBeTruthy();
  });

  it('starts a workout through the same route Train uses', async () => {
    const { findByLabelText } = await render(<ProgramOverviewScreen />);

    await fireEvent.press(await findByLabelText('Start Upper Body A'));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/workout/[id]', params: { id: 'tpl-a' } });
  });

  /**
   * Not knowing which workouts are done costs one orange label; refusing to show the program at
   * all over it would be a poor trade.
   */
  it('still shows the program when the sessions call fails', async () => {
    mockEnrollment.mockResolvedValue(activeEnrollment);
    mockSessions.mockRejectedValue(new Error('offline'));

    const { findByText } = await render(<ProgramOverviewScreen />);

    expect(await findByText('Upper Body A')).toBeTruthy();
  });

  it('surfaces a load failure rather than an empty screen', async () => {
    mockGet.mockRejectedValue(new Error('boom'));
    const { findByText } = await render(<ProgramOverviewScreen />);

    expect(await findByText('Could not load this program. Please try again.')).toBeTruthy();
  });
});
