// Phase I / Home. Ports the prototype's `isHome` branch (FORJD Mobile.dc.html lines 130-283),
// verified against the real screenshots `home1.png` and `home2.png` (home1 scrolls into home2).
//
// Six of Home's eight sections have no backend yet -- readiness and the four health metrics
// are Phase 6 (Health Connect), and the workout counters, "This week" and "Recent PR" are
// Phase 3 (the workout engine). Per this session's plan they are built at full visual
// fidelity with *honest empty values* rather than the design's demo numbers (147 workouts,
// 87 readiness, a 100 kg bench PR), which would be fabricated data. These tests pin the empty
// values, so the day a real source arrives the diff is a data swap and the assertions here
// are what change.
import { cleanup, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    useFocusEffect: (callback: () => void) => {
      react.useEffect(() => {
        callback();
      }, []);
    },
  };
});

jest.mock('@/auth/apiClient', () => ({
  getMe: jest.fn(),
  listNutritionLog: jest.fn(),
  getMacroGoals: jest.fn(),
}));

import { getMacroGoals, getMe, listNutritionLog } from '@/auth/apiClient';
import { formatHomeDate } from '@/features/home/date';

import HomeScreen from '../(tabs)/index';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

function meWithName(displayName: string | null) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'james@example.com',
    profile: displayName === null ? null : { displayName },
    privacy: {},
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (getMe as jest.Mock).mockResolvedValue(meWithName('James Mitchell'));
  (listNutritionLog as jest.Mock).mockResolvedValue({ items: [] });
  (getMacroGoals as jest.Mock).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
});

describe('Home header', () => {
  it('renders the wordmark and greets the user by first name', async () => {
    const screen = await render(<HomeScreen />);

    expect(screen.getByText('FORJD')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Hi, James')).toBeTruthy());
  });

  // "Hi, null" is the failure this guards against: `displayName` is nullable on every account
  // created before ADR-019, and a profile itself can be absent.
  it('renders no greeting line at all when there is no name', async () => {
    (getMe as jest.Mock).mockResolvedValue(meWithName(null));

    const screen = await render(<HomeScreen />);

    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.getByText('FORJD')).toBeTruthy();
    expect(screen.queryByText(/^Hi,/)).toBeNull();
  });

  it("shows today's date the way the prototype writes it", async () => {
    const screen = await render(<HomeScreen />);

    expect(screen.getByText(formatHomeDate(new Date()))).toBeTruthy();
  });
});

describe('Readiness card (no wearable data until Phase 6)', () => {
  it('renders its chrome with empty values rather than the design demo score', async () => {
    const screen = await render(<HomeScreen />);

    expect(screen.getByText('Readiness')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('Connect a wearable to see readiness')).toBeTruthy();
    // The design's 87/Good is demo data; nothing fabricates a score.
    expect(screen.queryByText('87')).toBeNull();
    expect(screen.queryByText('Good')).toBeNull();
  });

  it('renders the three readiness chips with no values yet', async () => {
    const screen = await render(<HomeScreen />);

    expect(screen.getByText('HRV —')).toBeTruthy();
    expect(screen.getByText('Sleep —')).toBeTruthy();
    expect(screen.getByText('RHR —')).toBeTruthy();
    expect(screen.queryByText('HRV stable')).toBeNull();
    expect(screen.queryByText('Sleep 7h 42m')).toBeNull();
  });
});

describe('Stat strip', () => {
  it('renders the four counters at zero and city rank as unknown', async () => {
    const screen = await render(<HomeScreen />);

    expect(screen.getByText('Workouts')).toBeTruthy();
    expect(screen.getByText('This Month')).toBeTruthy();
    expect(screen.getByText('City Rank')).toBeTruthy();
    expect(screen.getByText('Streak')).toBeTruthy();
    expect(screen.queryByText('147')).toBeNull();
    expect(screen.queryByText('#47')).toBeNull();
  });

  // The tooltip copy explains what the metric *is*, so it stays correct with no value behind
  // it -- it is the one part of the four metric cells that is not gated on Phase 6.
  it('opens a metric tooltip on tap and closes it on a second tap', async () => {
    const screen = await render(<HomeScreen />);

    expect(screen.queryByText(/Total time asleep last night/)).toBeNull();

    fireEvent.press(screen.getByLabelText('Sleep metric'));
    await waitFor(() => expect(screen.getByText(/Total time asleep last night/)).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Sleep metric'));
    await waitFor(() => expect(screen.queryByText(/Total time asleep last night/)).toBeNull());
  });

  it('shows one tooltip at a time', async () => {
    const screen = await render(<HomeScreen />);

    fireEvent.press(screen.getByLabelText('Sleep metric'));
    await waitFor(() => expect(screen.getByText(/Total time asleep last night/)).toBeTruthy());

    fireEvent.press(screen.getByLabelText('HRV metric'));

    await waitFor(() => expect(screen.getByText(/Heart rate variability/)).toBeTruthy());
    expect(screen.queryByText(/Total time asleep last night/)).toBeNull();
  });
});

describe('Insight card', () => {
  it('invites the user to log workouts instead of inventing an insight', async () => {
    const screen = await render(<HomeScreen />);

    expect(screen.getByText('Insight')).toBeTruthy();
    expect(screen.getByText("Log a few workouts and we'll start spotting patterns.")).toBeTruthy();
    expect(screen.queryByText(/Training load up 14%/)).toBeNull();
  });
});

describe('Start Workout', () => {
  // The prototype's `goSuggested` (line 1150) opens the user's active program if there is one
  // and falls through to Train otherwise. There is no programs backend yet, so every user
  // takes the fallback branch today; the program branch lands with Phase 3.
  it('routes to the Train tab, the design fallback when no program is active', async () => {
    const screen = await render(<HomeScreen />);

    fireEvent.press(screen.getByText('Start Workout'));

    expect(mockPush).toHaveBeenCalledWith('/(tabs)/train');
  });
});

describe('This week', () => {
  it('renders seven day bars and a zero session count', async () => {
    const screen = await render(<HomeScreen />);

    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.getByText('0 sessions')).toBeTruthy();
    expect(screen.getAllByLabelText(/^No session on /)).toHaveLength(7);
  });
});

describe('Recent PR', () => {
  it('says there is no PR yet rather than showing the design demo lift', async () => {
    const screen = await render(<HomeScreen />);

    expect(screen.getByText('Recent PR')).toBeTruthy();
    expect(screen.getByText('No PR yet')).toBeTruthy();
    expect(screen.getByText('Finish a workout to set one')).toBeTruthy();
    expect(screen.queryByText('Bench Press')).toBeNull();
  });
});

describe('Notifications bell', () => {
  // The design's destination is `notifsFeed`, which does not exist -- `notifs.tsx` is the
  // settings screen, a different one. train.tsx's precedent: render the control, route it
  // nowhere yet.
  it('renders but navigates nowhere', async () => {
    const screen = await render(<HomeScreen />);

    fireEvent.press(screen.getByLabelText('Notifications'));

    expect(mockPush).not.toHaveBeenCalled();
  });
});
