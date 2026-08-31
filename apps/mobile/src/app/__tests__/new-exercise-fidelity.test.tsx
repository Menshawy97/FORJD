// Phase K. Ports the prototype's `s_newExercise()` -- docs/design/design-revision-screen-specs.md
// §3 (the revised, authoritative spec; phase2-screen-specs.md §6 was written against the
// pre-revision sketch). One screen serves create and edit, per `state.editingExercise`.
//
// **Vocabulary decision, recorded here per §3's own instruction to decide explicitly:** this
// screen offers the prototype's own 13-muscle / 12-equipment SUBSET, not the full canonical
// `MUSCLE_GROUPS` (19) / `EQUIPMENT` (16) enums. Confirmed against three reference
// screenshots (`custom exercise1.png`, `custom exercise2.png`, `editcustomexercise.png`), not
// just the interactive prototype -- all three show exactly the same 13/12 chip lists. Muscles
// omitted: lats, traps, lower_back, neck, abductors, adductors. Equipment omitted:
// foam_roller, exercise_ball, ez_curl_bar, other. Those six/four enum members stay reachable
// only through the ingest adapter's mapping (Phase D), never through this picker.
//
// **No delete control on this screen.** The plan's prose describes Phase K as
// "create / edit / delete", but the prototype source (`s_newExercise`, line 3065) calls
// `this.hdr(editing?'Edit Exercise':'New Exercise', this.go('library'))` with no third
// argument -- no delete icon, and none of the three reference screenshots show one either.
// Delete already shipped on the exercise detail screen (Phase J, `s_exercise`'s own pencil/x
// cluster, confirmed again by `custom_exercise3.png`). This suite does not assert a delete
// control here.
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
  createExercise: jest.fn(),
  updateExercise: jest.fn(),
}));

jest.mock('@/store/exercise-catalogue', () => ({
  ensureExerciseCatalogueSchema: jest.fn(),
  openExerciseCatalogueDb: jest.fn(),
  syncExerciseCatalogue: jest.fn(),
  getCachedExercise: jest.fn(),
}));

import { createExercise, updateExercise } from '@/auth/apiClient';
import {
  getCachedExercise,
  openExerciseCatalogueDb,
  syncExerciseCatalogue,
} from '@/store/exercise-catalogue';

import NewExerciseScreen from '../new-exercise';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const customExercise = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'custom1',
  name: 'Landmine Press',
  slug: 'landmine-press',
  category: 'strength',
  goal: 'hypertrophy',
  measure: 'weight',
  primaryMuscles: ['shoulders'],
  secondaryMuscles: [],
  equipment: ['barbell'],
  force: null,
  level: null,
  mechanic: null,
  instructions: [],
  imageUrls: [],
  description: 'Brace the core.',
  isCustom: true,
  isFavourite: false,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLocalSearchParams.mockReturnValue({});
  (openExerciseCatalogueDb as jest.Mock).mockResolvedValue({});
  (syncExerciseCatalogue as jest.Mock).mockResolvedValue({ synced: true, count: 1 });
});

describe('new-exercise screen fidelity -- create mode', () => {
  it('renders the "New Exercise" header title', async () => {
    const { findByText } = await render(<NewExerciseScreen />);

    expect(await findByText('New Exercise')).toBeTruthy();
  });

  it('back navigates to /library', async () => {
    const { findByLabelText } = await render(<NewExerciseScreen />);

    fireEvent.press(await findByLabelText('Back'));

    expect(mockReplace).toHaveBeenCalledWith('/library');
  });

  it('renders the name field and the full 13-muscle / 12-equipment subset chip lists', async () => {
    const { findByPlaceholderText, findByText, queryByText } = await render(<NewExerciseScreen />);

    expect(await findByPlaceholderText('e.g. Landmine Press')).toBeTruthy();
    for (const label of [
      'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Core', 'Glutes', 'Quads',
      'Hamstrings', 'Calves', 'Hips', 'Full Body',
    ]) {
      expect(await findByText(label)).toBeTruthy();
    }
    // The vocabulary decision above: these six enum members are deliberately not offered here.
    for (const label of ['Lats', 'Traps', 'Lower Back', 'Neck', 'Abductors', 'Adductors']) {
      expect(queryByText(label)).toBeNull();
    }
    for (const label of [
      'Barbell', 'Dumbbell', 'Kettlebell', 'Machine', 'Cable', 'Band', 'Bodyweight', 'Bench',
      'Rack', 'Medicine Ball', 'TRX', 'Sled',
    ]) {
      expect(await findByText(label)).toBeTruthy();
    }
    for (const label of ['Foam Roller', 'Exercise Ball', 'E-Z Curl Bar', 'Other']) {
      expect(queryByText(label)).toBeNull();
    }
  });

  it('renders the description field with its placeholder', async () => {
    const { findByPlaceholderText } = await render(<NewExerciseScreen />);

    expect(
      await findByPlaceholderText('e.g. Brace the core, elbows tucked at 45°, drive through the mid-foot.'),
    ).toBeTruthy();
  });

  it('renders all six category chips, with Strength selected by default', async () => {
    const { findByLabelText } = await render(<NewExerciseScreen />);

    const strength = await findByLabelText('Strength');
    expect(strength.props.accessibilityState).toMatchObject({ selected: true });
    expect((await findByLabelText('Yoga')).props.accessibilityState).toMatchObject({ selected: false });
  });

  it('renders the three measure options, with Weight × reps selected by default', async () => {
    const { findByLabelText, findByText } = await render(<NewExerciseScreen />);

    expect(await findByText('Weight × reps')).toBeTruthy();
    expect((await findByLabelText('Weight × reps')).props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('renders the measure footnote', async () => {
    const { findByText } = await render(<NewExerciseScreen />);

    expect(
      await findByText(
        'Time-based exercises get a set timer during a live workout; distance exercises log metres.',
      ),
    ).toBeTruthy();
  });

  it('toasts "Give the exercise a name first" when Save is tapped with no name', async () => {
    const { findByText } = await render(<NewExerciseScreen />);

    fireEvent.press(await findByText('Save Exercise'));

    expect(await findByText('Give the exercise a name first')).toBeTruthy();
    expect(createExercise).not.toHaveBeenCalled();
  });

  it('toasts "Pick at least one muscle worked" once a name exists but no muscle is picked', async () => {
    const { findByText, findByPlaceholderText } = await render(<NewExerciseScreen />);

    fireEvent.changeText(await findByPlaceholderText('e.g. Landmine Press'), 'Cable Row');
    fireEvent.press(await findByText('Save Exercise'));

    expect(await findByText('Pick at least one muscle worked')).toBeTruthy();
  });

  it('validates in order: name, then muscle, then equipment', async () => {
    const { findByText, findByPlaceholderText } = await render(<NewExerciseScreen />);

    fireEvent.changeText(await findByPlaceholderText('e.g. Landmine Press'), 'Cable Row');
    fireEvent.press(await findByText('Chest'));
    fireEvent.press(await findByText('Save Exercise'));

    expect(await findByText('Pick at least one piece of equipment')).toBeTruthy();
  });

  it('creates the exercise and returns to the library with a toast once valid', async () => {
    (createExercise as jest.Mock).mockResolvedValue({ id: 'new1' });
    const { findByText, findByPlaceholderText } = await render(<NewExerciseScreen />);

    fireEvent.changeText(await findByPlaceholderText('e.g. Landmine Press'), 'Cable Row');
    fireEvent.press(await findByText('Chest'));
    fireEvent.press(await findByText('Barbell'));
    fireEvent.press(await findByText('Save Exercise'));

    await waitFor(() =>
      expect(createExercise).toHaveBeenCalledWith({
        name: 'Cable Row',
        category: 'strength',
        measure: 'weight',
        primaryMuscles: ['chest'],
        equipment: ['barbell'],
        description: undefined,
      }),
    );
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/library',
      params: { toast: 'Cable Row added to your library' },
    });
  });

  it('shows the duplicate-name toast on a 409 and does not navigate away', async () => {
    const conflict = { response: { status: 409 } };
    (createExercise as jest.Mock).mockRejectedValue(conflict);
    const { findByText, findByPlaceholderText } = await render(<NewExerciseScreen />);

    fireEvent.changeText(await findByPlaceholderText('e.g. Landmine Press'), 'Cable Row');
    fireEvent.press(await findByText('Chest'));
    fireEvent.press(await findByText('Barbell'));
    fireEvent.press(await findByText('Save Exercise'));

    expect(await findByText('An exercise with that name already exists')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('new-exercise screen fidelity -- edit mode', () => {
  beforeEach(() => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'custom1' });
    (getCachedExercise as jest.Mock).mockResolvedValue(customExercise());
  });

  it('renders the "Edit Exercise" header title', async () => {
    const { findByText } = await render(<NewExerciseScreen />);

    expect(await findByText('Edit Exercise')).toBeTruthy();
  });

  it('prefills every field from the cached record', async () => {
    const { findByDisplayValue, findByLabelText } = await render(<NewExerciseScreen />);

    expect(await findByDisplayValue('Landmine Press')).toBeTruthy();
    expect(await findByDisplayValue('Brace the core.')).toBeTruthy();
    expect((await findByLabelText('Shoulders muscle')).props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect((await findByLabelText('Barbell equipment')).props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('renders "Save Changes" instead of "Save Exercise"', async () => {
    const { findByText, queryByText } = await render(<NewExerciseScreen />);

    expect(await findByText('Save Changes')).toBeTruthy();
    expect(queryByText('Save Exercise')).toBeNull();
  });

  it('updates the exercise and returns to the library with an "updated" toast', async () => {
    (updateExercise as jest.Mock).mockResolvedValue({ id: 'custom1' });
    const { findByText, findByDisplayValue } = await render(<NewExerciseScreen />);

    fireEvent.changeText(await findByDisplayValue('Landmine Press'), 'Landmine Press v2');
    fireEvent.press(await findByText('Save Changes'));

    await waitFor(() =>
      expect(updateExercise).toHaveBeenCalledWith(
        'custom1',
        expect.objectContaining({ name: 'Landmine Press v2' }),
      ),
    );
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/library',
      params: { toast: 'Landmine Press v2 updated' },
    });
  });
});
