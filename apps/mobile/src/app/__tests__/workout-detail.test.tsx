// Phase 3G's deferred component tests for `s_workoutDetail()`, the other half of the gap the
// roadmap flagged alongside `builder.test.tsx`. The behaviour worth pinning here is the part
// the screen's own docblock calls out as a deliberate design choice and which is therefore
// easy to "simplify" away by mistake: exercise names come from the **on-device catalogue**
// (ADR-022's `exercises_cache`), not from the workout response, which carries only
// `exerciseId`. A refactor that started reading names off the server response would still
// render something plausible -- and would break offline.
//
// NOTE: @testing-library/react-native v14 made render() and every fireEvent.* async -- each
// returns a Promise and MUST be awaited. An un-awaited one leaves an open act() scope that
// silently empties the rendered tree for every LATER test in the file, presenting as
// "unable to find an element" on tests that pass in isolation.
//
// `@/workouts/builder-handoff` is deliberately NOT mocked, for the same reason as in
// `builder.test.tsx`: the Customise handoff is the thing under test, so the real
// set/consume pairing is what should run.
import { AxiosError } from 'axios';
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockUseLocalSearchParams = jest.fn(() => ({ id: 'template-1' }));

jest.mock('expo-router', () => {
  const react = require('react');
  return {
    router: {
      push: (...args: unknown[]) => mockPush(...args),
      back: (...args: unknown[]) => mockBack(...args),
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useFocusEffect: (callback: () => void | (() => void)) => {
      react.useEffect(() => callback(), []);
    },
  };
});

jest.mock('@/auth/apiClient', () => ({
  getWorkoutTemplate: jest.fn(),
}));

jest.mock('@/store/exercise-catalogue', () => ({
  openExerciseCatalogueDb: jest.fn(),
  getCachedExercise: jest.fn(),
}));

import { getWorkoutTemplate } from '@/auth/apiClient';
import { getCachedExercise, openExerciseCatalogueDb } from '@/store/exercise-catalogue';
import { consumeBuilderPrefill } from '@/workouts/builder-handoff';

import WorkoutDetailScreen from '../workout/[id]';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

function templateExercise(overrides: Record<string, unknown> = {}) {
  return {
    id: 'we-1',
    exerciseId: 'ex-1',
    orderIndex: 0,
    setCount: 4,
    targetReps: 8,
    targetRepsMax: null,
    targetWeightKg: null,
    targetSeconds: null,
    targetDistanceMeters: null,
    restSeconds: null,
    notes: null,
    ...overrides,
  };
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 'template-1',
    name: 'Upper / Lower',
    activity: 'strength',
    basedOnTemplateId: null,
    notes: null,
    estimatedDurationMinutes: 52,
    isCustom: true,
    blocks: [
      {
        id: 'block-1',
        type: 'straight_sets',
        orderIndex: 0,
        name: null,
        rounds: null,
        workSeconds: null,
        restSeconds: null,
        capSeconds: null,
        exercises: [templateExercise()],
      },
    ],
    ...overrides,
  };
}

const cachedExercise = (name: string, measure = 'weight') => ({
  id: 'ex-1',
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  category: 'strength',
  goal: 'hypertrophy',
  measure,
  primaryMuscles: ['chest'],
  secondaryMuscles: [],
  equipment: ['barbell'],
  force: null,
  level: null,
  mechanic: null,
  instructions: [],
  imageUrl: null,
  imageUrls: [],
  isCustom: false,
  isFavourite: false,
});

beforeEach(() => {
  jest.clearAllMocks();
  consumeBuilderPrefill();
  mockUseLocalSearchParams.mockReturnValue({ id: 'template-1' });
  (openExerciseCatalogueDb as jest.Mock).mockResolvedValue({});
  (getWorkoutTemplate as jest.Mock).mockResolvedValue(template());
  (getCachedExercise as jest.Mock).mockResolvedValue(cachedExercise('Bench Press'));
});

describe('loading the template', () => {
  it('requests the template named by the route param', async () => {
    await render(<WorkoutDetailScreen />);

    await waitFor(() => expect(getWorkoutTemplate).toHaveBeenCalledWith('template-1'));
  });

  it('renders the template name and its meta row', async () => {
    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('Upper / Lower')).toBeTruthy();
    expect(await findByText('Strength · 1 exercises · ~52 min')).toBeTruthy();
  });

  it('omits the duration from the meta row when the template has none', async () => {
    (getWorkoutTemplate as jest.Mock).mockResolvedValue(template({ estimatedDurationMinutes: null }));

    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('Strength · 1 exercises')).toBeTruthy();
  });
});

describe('exercise names come from the on-device catalogue', () => {
  it('resolves each exerciseId against the local cache and renders sets x target', async () => {
    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('Bench Press')).toBeTruthy();
    expect(await findByText('4×8 reps')).toBeTruthy();
    await waitFor(() => expect(getCachedExercise).toHaveBeenCalledWith({}, 'ex-1'));
  });

  it('falls back to a neutral name when the exercise is not in the local cache', async () => {
    (getCachedExercise as jest.Mock).mockResolvedValue(null);

    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('Exercise')).toBeTruthy();
  });

  it('labels a time-measured exercise in seconds, not reps', async () => {
    (getWorkoutTemplate as jest.Mock).mockResolvedValue(
      template({
        blocks: [
          {
            ...template().blocks[0],
            exercises: [templateExercise({ setCount: 3, targetReps: null, targetSeconds: 45 })],
          },
        ],
      }),
    );
    (getCachedExercise as jest.Mock).mockResolvedValue(cachedExercise('Plank', 'time'));

    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('3×45 s')).toBeTruthy();
  });

  it('labels a distance-measured exercise in metres', async () => {
    (getWorkoutTemplate as jest.Mock).mockResolvedValue(
      template({
        blocks: [
          {
            ...template().blocks[0],
            exercises: [
              templateExercise({ setCount: 1, targetReps: null, targetDistanceMeters: 5000 }),
            ],
          },
        ],
      }),
    );
    (getCachedExercise as jest.Mock).mockResolvedValue(cachedExercise('5K Run', 'distance'));

    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('1×5000 m')).toBeTruthy();
  });

  it('shows an em dash when a template exercise prescribes no target at all', async () => {
    (getWorkoutTemplate as jest.Mock).mockResolvedValue(
      template({
        blocks: [
          {
            ...template().blocks[0],
            exercises: [templateExercise({ targetReps: null })],
          },
        ],
      }),
    );

    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('4×—')).toBeTruthy();
  });
});

describe('the kind badge', () => {
  it('reads Custom for a from-scratch workout of the user', async () => {
    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('Custom')).toBeTruthy();
  });

  it('reads Customised preset once the template is based on one', async () => {
    (getWorkoutTemplate as jest.Mock).mockResolvedValue(template({ basedOnTemplateId: 'preset-9' }));

    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('Customised preset')).toBeTruthy();
  });

  it('reads Preset for a curated template, whatever basedOnTemplateId says', async () => {
    (getWorkoutTemplate as jest.Mock).mockResolvedValue(
      template({ isCustom: false, basedOnTemplateId: 'preset-9' }),
    );

    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('Preset')).toBeTruthy();
  });
});

describe('Customise hands off to the builder', () => {
  it('pushes the builder with the template copied into the prefill', async () => {
    const { findByLabelText, findByText } = await render(<WorkoutDetailScreen />);
    // The Customise CTA renders as soon as the template lands, which is BEFORE the catalogue
    // rows resolve -- pressing it too early would build the prefill from the fallback name.
    await findByText('Bench Press');

    await fireEvent.press(await findByLabelText('Customise'));

    expect(mockPush).toHaveBeenCalledWith('/builder');
    // The real handoff module, so this is the value the builder would actually consume.
    expect(consumeBuilderPrefill()).toEqual({
      basedOnTemplateId: 'template-1',
      name: 'Upper / Lower',
      activity: 'strength',
      exercises: [
        {
          exerciseId: 'ex-1',
          name: 'Bench Press',
          measure: 'weight',
          setCount: 4,
          targetReps: 8,
          targetSeconds: null,
          targetDistanceMeters: null,
        },
      ],
    });
  });

  it('carries the resolved catalogue name, not a placeholder, into the prefill', async () => {
    (getCachedExercise as jest.Mock).mockResolvedValue(cachedExercise('Barbell Row'));
    const { findByLabelText, findByText } = await render(<WorkoutDetailScreen />);
    await findByText('Barbell Row');

    await fireEvent.press(await findByLabelText('Customise'));

    expect(consumeBuilderPrefill()?.exercises[0].name).toBe('Barbell Row');
  });

  it('defaults an uncached exercise to the weight measure so the builder still renders it', async () => {
    (getCachedExercise as jest.Mock).mockResolvedValue(null);
    const { findByLabelText, findByText } = await render(<WorkoutDetailScreen />);
    await findByText('Exercise');

    await fireEvent.press(await findByLabelText('Customise'));

    expect(consumeBuilderPrefill()?.exercises[0].measure).toBe('weight');
  });

  it('offers nothing to press before the template has loaded', async () => {
    let resolveTemplate: ((value: unknown) => void) | undefined;
    (getWorkoutTemplate as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveTemplate = resolve;
      }),
    );

    const { queryByLabelText, findByLabelText } = await render(<WorkoutDetailScreen />);

    // The CTA is not rendered at all while loading, so there is no way to hand a null
    // template to the builder.
    expect(queryByLabelText('Customise')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();

    // Settle the deferred load before the test ends, otherwise its state commit lands on an
    // unmounted tree and React logs an act() warning attributed to the next test.
    resolveTemplate?.(template());
    await findByLabelText('Customise');
  });
});

describe('load failures', () => {
  it('tells an offline user to check their connection', async () => {
    (getWorkoutTemplate as jest.Mock).mockRejectedValue(new AxiosError('Network Error'));

    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('Cannot reach FORJD. Check your connection and try again.')).toBeTruthy();
  });

  it('shows generic copy for a server failure', async () => {
    const rejection = new AxiosError('Server Error');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rejection as any).response = { status: 500, data: { message: 'Internal server error' } };
    (getWorkoutTemplate as jest.Mock).mockRejectedValue(rejection);

    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('Could not load this workout.')).toBeTruthy();
  });

  it('surfaces a failure of the local catalogue read too, not just the network one', async () => {
    (openExerciseCatalogueDb as jest.Mock).mockRejectedValue(new Error('no such table'));

    const { findByText } = await render(<WorkoutDetailScreen />);

    expect(await findByText('Could not load this workout.')).toBeTruthy();
  });
});
