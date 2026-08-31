// Phase I. Ports the prototype's `s_library()` — docs/design/phase2-screen-specs.md §3.
// The store layer (`exercise-catalogue.ts`, `recent-exercises.ts`) has its own unit suites
// against real SQLite-shaped logic; this file verifies the screen's own behaviour — chip
// order, row content, favourite optimism-and-revert, empty states — against a mocked store,
// the same split `athlete.test.tsx` uses for `getAthlete`.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({}));
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

jest.mock('@/auth/apiClient', () => ({
  getExerciseCatalogue: jest.fn(),
  setExerciseFavourite: jest.fn(),
}));

jest.mock('@/store/exercise-catalogue', () => ({
  ensureExerciseCatalogueSchema: jest.fn(),
  openExerciseCatalogueDb: jest.fn(),
  syncExerciseCatalogue: jest.fn(),
  listCachedExercises: jest.fn(),
  searchExercises: jest.fn(),
  getCachedExercise: jest.fn(),
  setLocalFavourite: jest.fn(),
}));

jest.mock('@/store/recent-exercises', () => ({
  getRecentExerciseIds: jest.fn(),
}));

import { setExerciseFavourite } from '@/auth/apiClient';
import {
  listCachedExercises,
  openExerciseCatalogueDb,
  setLocalFavourite,
  syncExerciseCatalogue,
} from '@/store/exercise-catalogue';
import { getRecentExerciseIds } from '@/store/recent-exercises';

import LibraryScreen from '../library';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const exercise = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'ex1',
  name: 'Bench Press',
  slug: 'bench-press',
  category: 'strength',
  goal: 'hypertrophy',
  measure: 'weight',
  primaryMuscles: ['chest', 'triceps'],
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
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLocalSearchParams.mockReturnValue({});
  (openExerciseCatalogueDb as jest.Mock).mockResolvedValue({});
  (syncExerciseCatalogue as jest.Mock).mockResolvedValue({ synced: false, count: 0 });
  (listCachedExercises as jest.Mock).mockResolvedValue([]);
  (getRecentExerciseIds as jest.Mock).mockResolvedValue([]);
});

describe('library screen fidelity', () => {
  it('renders the header title and the New pill', async () => {
    const { findByText } = await render(<LibraryScreen />);

    expect(await findByText('Exercise Library')).toBeTruthy();
    expect(await findByText('New')).toBeTruthy();
  });

  it('renders the search placeholder with a real ellipsis character', async () => {
    const { findByPlaceholderText } = await render(<LibraryScreen />);

    expect(await findByPlaceholderText('Search exercises…')).toBeTruthy();
  });

  /** §3.4: eight chips, Favourites second, All selected by default. */
  it('renders all eight filter chips in the exact spec order', async () => {
    const { findByText } = await render(<LibraryScreen />);

    const labels = [
      'All',
      'Favourites',
      'Strength',
      'Running',
      'Cross Training',
      'Yoga',
      'Calisthenics',
      'Mobility',
    ];
    for (const label of labels) {
      expect(await findByText(label)).toBeTruthy();
    }
  });

  it('renders a row with icon tile, title, subtitle, and a star -- no trailing stat text', async () => {
    (listCachedExercises as jest.Mock).mockResolvedValue([exercise()]);

    const { findByText, queryByText } = await render(<LibraryScreen />);

    expect(await findByText('Bench Press')).toBeTruthy();
    expect(await findByText('Chest · Triceps')).toBeTruthy();
    // The screenshot's "80 kg × 8 × 4" is deliberately omitted -- see library.tsx's header
    // comment for why.
    expect(queryByText(/80 kg/)).toBeNull();
  });

  it('tapping a row navigates to the exercise detail route', async () => {
    (listCachedExercises as jest.Mock).mockResolvedValue([exercise()]);
    const { findByText } = await render(<LibraryScreen />);

    fireEvent.press(await findByText('Bench Press'));

    expect(mockPush).toHaveBeenCalledWith('/exercise/ex1');
  });

  it('tapping New navigates to /new-exercise', async () => {
    const { findByText } = await render(<LibraryScreen />);

    fireEvent.press(await findByText('New'));

    expect(mockPush).toHaveBeenCalledWith('/new-exercise');
  });

  it('shows the "no exercises match" empty state when nothing is cached', async () => {
    const { findByText } = await render(<LibraryScreen />);

    expect(await findByText('No exercises match.')).toBeTruthy();
  });

  it('shows the favourites empty state, with an em dash, when the Favourites chip is active and nothing is starred', async () => {
    const { findByText } = await render(<LibraryScreen />);

    fireEvent.press(await findByText('Favourites'));

    expect(await findByText('No favourite exercises yet — tap a star to add one.')).toBeTruthy();
  });

  it('suppresses the Recent section when the Favourites chip is active', async () => {
    (getRecentExerciseIds as jest.Mock).mockResolvedValue(['ex1']);
    const { findByText, queryByText } = await render(<LibraryScreen />);
    await waitFor(() => expect(getRecentExerciseIds).toHaveBeenCalled());

    fireEvent.press(await findByText('Favourites'));

    await waitFor(() => expect(queryByText('Recent')).toBeNull());
  });

  it('toggles a favourite locally and calls the API, star icon reflecting the new state', async () => {
    (listCachedExercises as jest.Mock).mockResolvedValue([exercise({ isFavourite: false })]);
    (setExerciseFavourite as jest.Mock).mockResolvedValue(undefined);
    const { findByLabelText } = await render(<LibraryScreen />);

    const star = await findByLabelText('Add favourite');
    fireEvent.press(star);

    await waitFor(() => expect(setLocalFavourite).toHaveBeenCalledWith({}, 'ex1', true));
    await waitFor(() => expect(setExerciseFavourite).toHaveBeenCalledWith('ex1', true));
  });

  it('reverts the local favourite state when the API call fails', async () => {
    (listCachedExercises as jest.Mock).mockResolvedValue([exercise({ isFavourite: false })]);
    (setExerciseFavourite as jest.Mock).mockRejectedValue(new Error('network down'));
    const { findByLabelText } = await render(<LibraryScreen />);

    fireEvent.press(await findByLabelText('Add favourite'));

    await waitFor(() => expect(setLocalFavourite).toHaveBeenCalledWith({}, 'ex1', false));
  });

  it('renders the tab bar with Train active', async () => {
    const { findByLabelText } = await render(<LibraryScreen />);

    const trainTab = await findByLabelText('Train');
    expect(trainTab.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('back navigates to /train', async () => {
    const { findByLabelText } = await render(<LibraryScreen />);

    fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/train');
  });

  // The exercise detail screen's delete confirmation (§4.3) navigates back here with a
  // `toast` param -- this screen unmounts on delete, so it cannot show its own toast.
  it('shows a toast from the `toast` search param, e.g. after deleting a custom exercise', async () => {
    mockUseLocalSearchParams.mockReturnValue({ toast: 'Exercise deleted' });
    const { findByText } = await render(<LibraryScreen />);

    expect(await findByText('Exercise deleted')).toBeTruthy();
  });
});
