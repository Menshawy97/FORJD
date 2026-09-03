// RED first, Phase 3J-d -- the exercise-detail screen's stat tiles, top-set trend and History
// list, once there is something real to put in them.
//
// Phase 2 shipped all three as honest empty states because nothing could count a set.
// `exercise-detail-fidelity.test.tsx` still pins those, deliberately: they are what an
// exercise the athlete has never performed shows, and what a failed history read falls back
// to. This file pins the other half.
//
// NOTE: RTL v14 -- render() and every fireEvent.* return Promises and must be awaited.
import { render as rtlRender } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'ex1' }),
}));

jest.mock('@/auth/apiClient', () => ({
  getExerciseCatalogue: jest.fn(),
  getExerciseHistory: jest.fn(),
  setExerciseFavourite: jest.fn(),
  deleteExercise: jest.fn(),
}));

jest.mock('@/store/exercise-catalogue', () => ({
  ensureExerciseCatalogueSchema: jest.fn(),
  openExerciseCatalogueDb: jest.fn(),
  syncExerciseCatalogue: jest.fn(),
  getCachedExercise: jest.fn(),
  setLocalFavourite: jest.fn(),
  removeCachedExercise: jest.fn(),
}));

jest.mock('@/store/recent-exercises', () => ({ recordExerciseOpened: jest.fn() }));

import { getExerciseHistory } from '@/auth/apiClient';
import {
  getCachedExercise,
  openExerciseCatalogueDb,
  syncExerciseCatalogue,
} from '@/store/exercise-catalogue';

import ExerciseDetailScreen from '../exercise/[id]';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const history = (overrides: Record<string, unknown> = {}) => ({
  bestSet: { weightKg: 100, reps: 3, achievedAt: '2026-08-12T10:20:00.000Z' },
  estimatedOneRepMaxKg: 106.7,
  sessions: [
    {
      sessionId: '11111111-1111-4111-8111-111111111111',
      sessionName: 'Push Day',
      // Yesterday, against the frozen clock below.
      performedAt: new Date('2026-09-02T10:00:00').toISOString(),
      weightKg: 80,
      reps: 8,
    },
    {
      sessionId: '22222222-2222-4222-8222-222222222222',
      sessionName: 'Push Day',
      performedAt: new Date('2026-08-16T10:00:00').toISOString(),
      weightKg: 77.5,
      reps: 8,
    },
  ],
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-09-03T09:00:00'));
  (openExerciseCatalogueDb as jest.Mock).mockResolvedValue({});
  (syncExerciseCatalogue as jest.Mock).mockResolvedValue({ synced: false, count: 0 });
  (getCachedExercise as jest.Mock).mockResolvedValue({
    id: 'ex1',
    name: 'Bench Press',
    slug: 'bench-press',
    category: 'strength',
    goal: 'hypertrophy',
    measure: 'weight',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: ['barbell'],
    force: 'push',
    level: 'beginner',
    mechanic: 'compound',
    instructions: [],
    imageUrls: [],
    description: null,
    isCustom: false,
    isFavourite: false,
  });
  (getExerciseHistory as jest.Mock).mockResolvedValue(history());
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the stat tiles', () => {
  it('shows the best set and its estimated one-rep max', async () => {
    const screen = await render(<ExerciseDetailScreen />);

    expect(await screen.findByText('100 kg × 3')).toBeTruthy();
    expect(await screen.findByText('106.7')).toBeTruthy();
  });

  // The two tiles are independent: Epley refuses past twelve reps, so a real best set can have
  // no estimate. That tile keeps its em dash rather than showing a number the formula cannot
  // stand behind.
  it('keeps the estimate empty beside a real best set the formula cannot speak to', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue(
      history({
        bestSet: { weightKg: 60, reps: 20, achievedAt: '2026-08-12T10:20:00.000Z' },
        estimatedOneRepMaxKg: null,
      }),
    );

    const screen = await render(<ExerciseDetailScreen />);

    expect(await screen.findByText('60 kg × 20')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBe(1);
  });

  it('leaves both empty for an exercise never performed', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue({
      bestSet: null,
      estimatedOneRepMaxKg: null,
      sessions: [],
    });

    const screen = await render(<ExerciseDetailScreen />);

    expect(await screen.findByText('Best set')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBe(2);
    expect(screen.getByText('No sessions logged yet.')).toBeTruthy();
  });
});

describe('the History list', () => {
  it('lists each session with its own top set', async () => {
    const screen = await render(<ExerciseDetailScreen />);

    expect(await screen.findByText('80 kg × 8')).toBeTruthy();
    expect(screen.getByText('77.5 kg × 8')).toBeTruthy();
  });

  // The prototype's own rows read `Yesterday`, `16 Aug`, `12 Aug` -- relative while that reads
  // better, then a date, because "three weeks ago" does not help locate a session in a list.
  it('dates recent sessions relatively and older ones by date', async () => {
    const screen = await render(<ExerciseDetailScreen />);

    expect(await screen.findByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('16 Aug')).toBeTruthy();
  });
});

describe('the top-set trend', () => {
  it('draws the trend once there are two sessions to draw it between', async () => {
    const screen = await render(<ExerciseDetailScreen />);

    await screen.findByText('80 kg × 8');
    expect(screen.queryByText('Log a set to see your trend.')).toBeNull();
  });

  // One session is not a trend, and the prototype's own `(pts.length - 1)` divisor is a
  // division by zero there.
  it('keeps the copy rather than drawing a line through a single point', async () => {
    (getExerciseHistory as jest.Mock).mockResolvedValue(
      history({ sessions: [history().sessions[0]] }),
    );

    const screen = await render(<ExerciseDetailScreen />);

    expect(await screen.findByText('Log a set to see your trend.')).toBeTruthy();
  });
});
