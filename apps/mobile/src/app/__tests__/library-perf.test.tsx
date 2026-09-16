// R21 (H15): the exercise library is a ~1,700-row `SectionList`. Two things made it slower than
// it needed to be:
//
// 1. `renderItem` was an inline closure defined directly in JSX, so it got a brand-new identity
//    on every render of the screen -- including a render caused only by toggling one favourite,
//    which re-fetches the whole `items` array from the catalogue store. `SectionList`/
//    `VirtualizedList` treats a changed `renderItem` as a reason to distrust its own internal
//    per-row state, which is a bigger cost than the one row that actually changed deserves.
// 2. No `getItemLayout` was supplied, so the list could not skip its own measurement pass on a
//    catalogue this size.
//
// `renderItem`'s own identity is the thing this file can actually observe from outside the
// component -- see the `SectionList` mock below for why toJSON()'s host-node tree cannot see it
// directly. `getItemLayout`'s *correctness* is covered more directly by unit-testing the pure
// `getLibraryItemLayout` function library.tsx exports for exactly this reason.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockUseLocalSearchParams = jest.fn(() => ({}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
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

/**
 * Captures the props `library.tsx` actually hands `SectionList` on every commit.
 * `render(...).toJSON()` only reaches native host nodes (the `View`/`Text` a `SectionList`
 * eventually renders down to), not props on the `SectionList` element itself -- `renderItem`
 * and `getItemLayout` never appear in that tree at all. Wrapping the real `SectionList` here
 * (rather than replacing it) keeps every existing row/empty-state/toast assertion pattern in
 * `library-fidelity.test.tsx` working unmodified for any test that reuses this file's mocks.
 */
const capturedSectionListProps: Array<{ renderItem: unknown; getItemLayout: unknown }> = [];
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  const RealSectionList = RN.SectionList;
  function CapturingSectionList(props: Record<string, unknown>) {
    capturedSectionListProps.push({ renderItem: props.renderItem, getItemLayout: props.getItemLayout });
    return <RealSectionList {...props} />;
  }
  // Redefine the real module's own SectionList property rather than `{ ...RN, SectionList: ... }`
  // (which forces every one of react-native's lazily-getter-backed exports, DevMenu among them,
  // to resolve eagerly -- and DevMenu's getter throws outside a real native runtime) or a plain
  // assignment (`SectionList` is itself getter-only, so `RN.SectionList = ...` silently no-ops).
  // `defineProperty` replaces just this one export and leaves every other export's laziness
  // untouched.
  Object.defineProperty(RN, 'SectionList', { value: CapturingSectionList, configurable: true });
  return RN;
});

import { setExerciseFavourite } from '@/auth/apiClient';
import {
  listCachedExercises,
  openExerciseCatalogueDb,
  setLocalFavourite,
  syncExerciseCatalogue,
} from '@/store/exercise-catalogue';
import { getRecentExerciseIds } from '@/store/recent-exercises';

import LibraryScreen, { getLibraryItemLayout } from '../library';

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
  capturedSectionListProps.length = 0;
  mockUseLocalSearchParams.mockReturnValue({});
  (openExerciseCatalogueDb as jest.Mock).mockResolvedValue({});
  (syncExerciseCatalogue as jest.Mock).mockResolvedValue({ synced: false, count: 0 });
  (listCachedExercises as jest.Mock).mockResolvedValue([]);
  (getRecentExerciseIds as jest.Mock).mockResolvedValue([]);
});

describe('library screen -- renderItem and getItemLayout', () => {
  it('supplies a getItemLayout function to the SectionList', async () => {
    (listCachedExercises as jest.Mock).mockResolvedValue([exercise()]);
    await render(<LibraryScreen />);

    await waitFor(() => expect(capturedSectionListProps.length).toBeGreaterThan(0));
    // Non-null: the waitFor above guarantees at least one captured props object.
    const last = capturedSectionListProps[capturedSectionListProps.length - 1]!;
    expect(typeof last.getItemLayout).toBe('function');
  });

  /**
   * The regression this guards: `renderItem` used to be an inline closure in JSX, so every
   * render of the screen -- including the one caused by toggling a favourite -- produced a new
   * function. A `SectionList` that sees `renderItem` change identity re-renders every visible
   * row, not just the one whose data actually changed.
   */
  it('keeps renderItem referentially stable when toggling a favourite', async () => {
    (listCachedExercises as jest.Mock).mockResolvedValue([exercise({ isFavourite: false })]);
    (setExerciseFavourite as jest.Mock).mockResolvedValue(undefined);
    const { findByLabelText } = await render(<LibraryScreen />);

    const star = await findByLabelText('Add favourite');
    const rendersBeforeToggle = capturedSectionListProps.length;
    // Non-null: findByLabelText above only resolves once at least one render has been captured.
    const renderItemBeforeToggle = capturedSectionListProps[rendersBeforeToggle - 1]!.renderItem;

    fireEvent.press(star);
    await waitFor(() => expect(setLocalFavourite).toHaveBeenCalledWith({}, 'ex1', true));
    await waitFor(() => expect(setExerciseFavourite).toHaveBeenCalledWith('ex1', true));
    await waitFor(() => expect(capturedSectionListProps.length).toBeGreaterThan(rendersBeforeToggle));

    // Non-null: the waitFor above guarantees a render past rendersBeforeToggle exists.
    const renderItemAfterToggle = capturedSectionListProps[capturedSectionListProps.length - 1]!.renderItem;
    expect(renderItemAfterToggle).toBe(renderItemBeforeToggle);
  });

  it('changes renderItem when the empty-state copy it closes over actually changes (the Favourites filter)', async () => {
    const { findByText } = await render(<LibraryScreen />);
    await waitFor(() => expect(capturedSectionListProps.length).toBeGreaterThan(0));
    // Non-null: the waitFor above guarantees at least one captured props object.
    const renderItemBeforeFilterChange = capturedSectionListProps[capturedSectionListProps.length - 1]!.renderItem;

    fireEvent.press(await findByText('Favourites'));
    await waitFor(() => expect(listCachedExercises).toHaveBeenLastCalledWith({}, expect.anything()));

    const renderItemAfterFilterChange = capturedSectionListProps[capturedSectionListProps.length - 1]!.renderItem;
    expect(renderItemAfterFilterChange).not.toBe(renderItemBeforeFilterChange);
  });
});

describe('getLibraryItemLayout', () => {
  const ROW_HEIGHT = 64;

  it('lays the header out at offset 0 at the start of a section', () => {
    const sections = [{ key: 'all', data: ['a', 'b', 'c'] }];

    expect(getLibraryItemLayout(sections, 0)).toEqual({ length: 44, offset: 0, index: 0 });
  });

  it('lays fixed-height rows out one after another following the header', () => {
    const sections = [{ key: 'all', data: ['a', 'b', 'c'] }];

    expect(getLibraryItemLayout(sections, 1)).toEqual({ length: ROW_HEIGHT, offset: 44, index: 1 });
    expect(getLibraryItemLayout(sections, 2)).toEqual({
      length: ROW_HEIGHT,
      offset: 44 + ROW_HEIGHT,
      index: 2,
    });
    expect(getLibraryItemLayout(sections, 3)).toEqual({
      length: ROW_HEIGHT,
      offset: 44 + 2 * ROW_HEIGHT,
      index: 3,
    });
  });

  it('gives the Recent section its own, shorter header height, before the All exercises section', () => {
    const sections = [
      { key: 'recent', data: ['r1'] },
      { key: 'all', data: ['a1', 'a2'] },
    ];

    // recent header (30) then its one row (ROW_HEIGHT), then the all-exercises header (44).
    expect(getLibraryItemLayout(sections, 0)).toEqual({ length: 30, offset: 0, index: 0 });
    expect(getLibraryItemLayout(sections, 1)).toEqual({ length: ROW_HEIGHT, offset: 30, index: 1 });
    expect(getLibraryItemLayout(sections, 2)).toEqual({
      length: 44,
      offset: 30 + ROW_HEIGHT,
      index: 2,
    });
    expect(getLibraryItemLayout(sections, 3)).toEqual({
      length: ROW_HEIGHT,
      offset: 30 + ROW_HEIGHT + 44,
      index: 3,
    });
  });

  it('degrades to the last known offset for an index past the end, rather than throwing', () => {
    const sections = [{ key: 'all', data: ['a'] }];

    expect(() => getLibraryItemLayout(sections, 99)).not.toThrow();
  });
});
