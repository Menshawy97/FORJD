// Phase J. Ports the prototype's `s_exercise()` / `s_exerciseRun()` --
// docs/design/phase2-screen-specs.md §4-5. Reads from the on-device catalogue (Phase H) the
// same way `library.tsx` does, offline-first per CLAUDE.md rule 6. Stat tiles, sparkline and
// history are Phase 3 data and are deliberately omitted (§4.2's own note) -- this suite never
// asserts their presence.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({ id: 'ex1' }));
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

jest.mock('@/store/recent-exercises', () => ({
  recordExerciseOpened: jest.fn(),
}));

import { deleteExercise, setExerciseFavourite } from '@/auth/apiClient';
import {
  getCachedExercise,
  openExerciseCatalogueDb,
  removeCachedExercise,
  setLocalFavourite,
  syncExerciseCatalogue,
} from '@/store/exercise-catalogue';
import { recordExerciseOpened } from '@/store/recent-exercises';

import ExerciseDetailScreen from '../exercise/[id]';

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
  equipment: ['barbell', 'bench'],
  force: 'push',
  level: 'beginner',
  mechanic: 'compound',
  instructions: ['Lie on the bench.', 'Lower the bar to your chest.'],
  imageUrls: [],
  description: null,
  isCustom: false,
  isFavourite: false,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLocalSearchParams.mockReturnValue({ id: 'ex1' });
  (openExerciseCatalogueDb as jest.Mock).mockResolvedValue({});
  (syncExerciseCatalogue as jest.Mock).mockResolvedValue({ synced: false, count: 0 });
  (getCachedExercise as jest.Mock).mockResolvedValue(exercise());
});

describe('exercise detail screen fidelity', () => {
  it('records the open for the recency store', async () => {
    await render(<ExerciseDetailScreen />);

    await waitFor(() => expect(recordExerciseOpened).toHaveBeenCalledWith('ex1'));
  });

  it('renders the exercise name as the header title', async () => {
    const { findByText } = await render(<ExerciseDetailScreen />);

    expect(await findByText('Bench Press')).toBeTruthy();
  });

  it('back navigates to /library', async () => {
    const { findByLabelText } = await render(<ExerciseDetailScreen />);

    fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/library');
  });

  it('renders a tag pill for each primary muscle plus the goal', async () => {
    const { findByText } = await render(<ExerciseDetailScreen />);

    expect(await findByText('Chest')).toBeTruthy();
    expect(await findByText('Triceps')).toBeTruthy();
    expect(await findByText('Hypertrophy')).toBeTruthy();
  });

  it('renders the Equipment block with a pill per item when equipment is present', async () => {
    const { findByText } = await render(<ExerciseDetailScreen />);

    expect(await findByText('Equipment')).toBeTruthy();
    expect(await findByText('Barbell')).toBeTruthy();
    expect(await findByText('Bench')).toBeTruthy();
  });

  it('omits the Equipment block entirely when there is no equipment', async () => {
    (getCachedExercise as jest.Mock).mockResolvedValue(exercise({ equipment: [] }));

    const { findByText, queryByText } = await render(<ExerciseDetailScreen />);

    await findByText('Bench Press');
    expect(queryByText('Equipment')).toBeNull();
  });

  it('renders the "How to train it" tip, using the curated copy for a named exercise', async () => {
    const { findByText } = await render(<ExerciseDetailScreen />);

    expect(await findByText('How to train it: ')).toBeTruthy();
    expect(
      await findByText(
        'Keep shoulder blades pinned back and drive through your feet — a stable base lets you press harder without straining the shoulders.',
      ),
    ).toBeTruthy();
  });

  it('falls back to the muscle-group tip when the exercise name has no curated copy', async () => {
    (getCachedExercise as jest.Mock).mockResolvedValue(
      exercise({ name: 'Cable Crossover', primaryMuscles: ['chest'] }),
    );

    const { findByText } = await render(<ExerciseDetailScreen />);

    expect(
      await findByText(
        'Warm the joint up with a lighter set first, and keep the movement smooth — jerky reps shift stress to the joint instead of the muscle.',
      ),
    ).toBeTruthy();
  });

  it('renders the Best set / Est. 1RM stat tiles with an honest empty state, not fake numbers', async () => {
    const { findByText, findAllByText } = await render(<ExerciseDetailScreen />);

    expect(await findByText('Best set')).toBeTruthy();
    expect(await findByText('Est. 1RM')).toBeTruthy();
    expect((await findAllByText('—')).length).toBe(2);
  });

  it('renders the sparkline card with an honest empty state', async () => {
    const { findByText } = await render(<ExerciseDetailScreen />);

    expect(await findByText('Top set — last 8 sessions')).toBeTruthy();
    expect(await findByText('Log a set to see your trend.')).toBeTruthy();
  });

  it('renders the History section with an honest empty state', async () => {
    const { findByText } = await render(<ExerciseDetailScreen />);

    expect(await findByText('History')).toBeTruthy();
    expect(await findByText('No sessions logged yet.')).toBeTruthy();
  });

  it('renders Instructions when the exercise has them', async () => {
    const { findByText } = await render(<ExerciseDetailScreen />);

    expect(await findByText('Instructions')).toBeTruthy();
    expect(await findByText('Lie on the bench.')).toBeTruthy();
    expect(await findByText('Lower the bar to your chest.')).toBeTruthy();
  });

  it('omits Instructions when the exercise has none', async () => {
    (getCachedExercise as jest.Mock).mockResolvedValue(exercise({ instructions: [] }));

    const { findByText, queryByText } = await render(<ExerciseDetailScreen />);

    await findByText('Bench Press');
    expect(queryByText('Instructions')).toBeNull();
  });

  it('hides the pencil and delete controls for a catalogue (non-custom) exercise', async () => {
    const { findByText, queryByLabelText } = await render(<ExerciseDetailScreen />);

    await findByText('Bench Press');
    expect(queryByLabelText('Edit exercise')).toBeNull();
    expect(queryByLabelText('Delete exercise')).toBeNull();
  });

  it('shows the pencil and delete controls for a custom exercise', async () => {
    (getCachedExercise as jest.Mock).mockResolvedValue(exercise({ isCustom: true }));

    const { findByLabelText } = await render(<ExerciseDetailScreen />);

    expect(await findByLabelText('Edit exercise')).toBeTruthy();
    expect(await findByLabelText('Delete exercise')).toBeTruthy();
  });

  it('tapping the pencil navigates to the edit screen', async () => {
    (getCachedExercise as jest.Mock).mockResolvedValue(exercise({ isCustom: true }));
    const { findByLabelText } = await render(<ExerciseDetailScreen />);

    fireEvent.press(await findByLabelText('Edit exercise'));

    expect(mockPush).toHaveBeenCalledWith('/new-exercise?id=ex1');
  });

  it('toggles the favourite locally and calls the API', async () => {
    (setExerciseFavourite as jest.Mock).mockResolvedValue(undefined);
    const { findByLabelText } = await render(<ExerciseDetailScreen />);

    fireEvent.press(await findByLabelText('Add favourite'));

    await waitFor(() => expect(setLocalFavourite).toHaveBeenCalledWith({}, 'ex1', true));
    await waitFor(() => expect(setExerciseFavourite).toHaveBeenCalledWith('ex1', true));
  });

  it('reverts the local favourite state when the API call fails', async () => {
    (setExerciseFavourite as jest.Mock).mockRejectedValue(new Error('network down'));
    const { findByLabelText, findByText } = await render(<ExerciseDetailScreen />);

    fireEvent.press(await findByLabelText('Add favourite'));

    await waitFor(() => expect(setLocalFavourite).toHaveBeenCalledWith({}, 'ex1', false));
    expect(await findByText('Could not update favourite. Please try again.')).toBeTruthy();
  });

  describe('delete confirmation sheet', () => {
    async function renderCustom() {
      (getCachedExercise as jest.Mock).mockResolvedValue(exercise({ isCustom: true }));
      return render(<ExerciseDetailScreen />);
    }

    it('opens the sheet on delete tap, with the reworded (soft-delete) copy', async () => {
      const { findByLabelText, findByText } = await renderCustom();

      fireEvent.press(await findByLabelText('Delete exercise'));

      expect(await findByText('Delete exercise?')).toBeTruthy();
      // Reworded per §8: we soft-delete, so "permanently removed... can't be undone" is false.
      expect(await findByText('“Bench Press” will be removed from the library.')).toBeTruthy();
    });

    it('Cancel closes the sheet without deleting', async () => {
      const { findByLabelText, findByText, queryByText } = await renderCustom();
      fireEvent.press(await findByLabelText('Delete exercise'));
      fireEvent.press(await findByText('Cancel'));

      await waitFor(() => expect(queryByText('Delete exercise?')).toBeNull());
      expect(deleteExercise).not.toHaveBeenCalled();
    });

    it('Delete calls the API, removes the local row, and returns to the library with a toast', async () => {
      (deleteExercise as jest.Mock).mockResolvedValue(undefined);
      const { findByLabelText, findByText } = await renderCustom();
      fireEvent.press(await findByLabelText('Delete exercise'));

      fireEvent.press(await findByText('Delete'));

      await waitFor(() => expect(deleteExercise).toHaveBeenCalledWith('ex1'));
      await waitFor(() => expect(removeCachedExercise).toHaveBeenCalledWith({}, 'ex1'));
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/library',
        params: { toast: 'Exercise deleted' },
      });
    });
  });

  describe('running variant', () => {
    const runningExercise = () =>
      exercise({
        category: 'running',
        goal: 'muscular_endurance',
        primaryMuscles: ['legs'],
        equipment: [],
        instructions: [],
      });

    it('appends a Running tag to the muscle and goal pills', async () => {
      (getCachedExercise as jest.Mock).mockResolvedValue(runningExercise());
      const { findByText } = await render(<ExerciseDetailScreen />);

      expect(await findByText('Running')).toBeTruthy();
    });

    it('never shows the "How to train it" tip -- the prototype only renders it for s_exercise', async () => {
      (getCachedExercise as jest.Mock).mockResolvedValue(runningExercise());
      const { findByText, queryByText } = await render(<ExerciseDetailScreen />);

      await findByText('Running');
      expect(queryByText('How to train it: ')).toBeNull();
    });

    it('never shows the pencil or delete controls, even for a custom running exercise', async () => {
      (getCachedExercise as jest.Mock).mockResolvedValue({ ...runningExercise(), isCustom: true });
      const { findByText, queryByLabelText } = await render(<ExerciseDetailScreen />);

      await findByText('Bench Press');
      expect(queryByLabelText('Edit exercise')).toBeNull();
      expect(queryByLabelText('Delete exercise')).toBeNull();
    });

    it('still shows the star and lets it be toggled', async () => {
      (getCachedExercise as jest.Mock).mockResolvedValue(runningExercise());
      const { findByLabelText } = await render(<ExerciseDetailScreen />);

      expect(await findByLabelText('Add favourite')).toBeTruthy();
    });

    it('renders the Best time / Avg pace stat tiles with an honest empty state', async () => {
      (getCachedExercise as jest.Mock).mockResolvedValue(runningExercise());
      const { findByText, findAllByText } = await render(<ExerciseDetailScreen />);

      expect(await findByText('Best time')).toBeTruthy();
      expect(await findByText('Avg pace')).toBeTruthy();
      expect((await findAllByText('—')).length).toBe(2);
    });

    it('renders the route map placeholder with an honest empty state, not a fake route', async () => {
      (getCachedExercise as jest.Mock).mockResolvedValue(runningExercise());
      const { findByText } = await render(<ExerciseDetailScreen />);

      expect(await findByText('No routes logged yet.')).toBeTruthy();
    });

    it('renders the pace sparkline card with an honest empty state', async () => {
      (getCachedExercise as jest.Mock).mockResolvedValue(runningExercise());
      const { findByText } = await render(<ExerciseDetailScreen />);

      expect(await findByText('Pace trend — 8 runs')).toBeTruthy();
      expect(await findByText('Log a run to see your trend.')).toBeTruthy();
    });

    it('renders the Recent runs section with an honest empty state', async () => {
      (getCachedExercise as jest.Mock).mockResolvedValue(runningExercise());
      const { findByText } = await render(<ExerciseDetailScreen />);

      expect(await findByText('Recent runs')).toBeTruthy();
      expect(await findByText('No runs logged yet.')).toBeTruthy();
    });
  });

  it('renders the tab bar with Train active', async () => {
    const { findByLabelText } = await render(<ExerciseDetailScreen />);

    const trainTab = await findByLabelText('Train');
    expect(trainTab.props.accessibilityState).toMatchObject({ selected: true });
  });
});
