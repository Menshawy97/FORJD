// Phase J. Ports the prototype's `s_nutritionShare()`, cross-checked against the real
// screenshots (`nutritionShare1.png` through `nutritionShare4.png`) rather than the prototype
// alone -- mirrors `nutrition-fidelity.test.tsx`'s shape (mock `@/auth/apiClient`, mock
// `expo-router`, `SafeAreaProvider` wrapper).
import { cleanup, fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock('@/auth/apiClient', () => ({
  listNutritionLog: jest.fn(),
  getMacroGoals: jest.fn(),
  getFood: jest.fn(),
}));

// The background-photo picker (gallery + camera), mirroring edit-profile.test.tsx's own
// `expo-image-picker` mock shape, extended with the camera pair nothing else in the codebase
// calls yet.
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

// The client-side downsize step -- a lightweight resize, not a formal pipeline, so only the
// one legacy `manipulateAsync` entry point this screen actually calls needs a mock.
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { getFood, getMacroGoals, listNutritionLog } from '@/auth/apiClient';

import { todayLocalDate } from '@/nutrition/date';

import NutritionShareScreen from '../nutrition-share';

const TODAY = todayLocalDate();

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: HostNode[] | null;
}

function flatten(node: unknown): HostNode[] {
  if (!node || typeof node !== 'object') {
    return [];
  }
  const host = node as HostNode;
  return [host, ...(host.children ?? []).flatMap(flatten)];
}

const GOALS = { kcal: 2000, protein: 150, carbs: 200, fat: 100 };

const STRAWBERRIES_ID = '11111111-1111-4111-8111-111111111111';
const BANANA_ID = '22222222-2222-4222-8222-222222222222';

const strawberries = {
  id: STRAWBERRIES_ID,
  name: 'Strawberries',
  category: 'fruits' as const,
  macrosPer100g: { kcal: 32, protein: 0.7, carbs: 7.7, fat: 0.3 },
  servings: [{ label: '1 cup (152g)', grams: 152 }],
  isCustom: false,
};

const banana = {
  id: BANANA_ID,
  name: 'Banana, raw',
  category: 'fruits' as const,
  macrosPer100g: { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
  servings: [{ label: '1 medium (118g)', grams: 118 }],
  isCustom: false,
};

// Sums to kcal 600 / protein 75 / carbs 100 / fat 25 against GOALS above, i.e. exactly 30% of
// the calorie goal and 50% / 50% / 25% of the three macro goals -- deterministic bar-width and
// ring-offset math, not just "renders without crashing".
const entryA = {
  id: 'entry-a',
  foodId: STRAWBERRIES_ID,
  loggedDate: TODAY,
  slot: 'breakfast' as const,
  servingLabel: '1 cup (152g)',
  grams: 152,
  kcal: 400,
  protein: 50,
  carbs: 60,
  fat: 15,
  groupId: null,
};

const entryB = {
  id: 'entry-b',
  foodId: BANANA_ID,
  loggedDate: TODAY,
  slot: 'lunch' as const,
  servingLabel: '1 medium (118g)',
  grams: 118,
  kcal: 200,
  protein: 25,
  carbs: 40,
  fat: 10,
  groupId: null,
};

function mockFoods() {
  (getFood as jest.Mock).mockImplementation(async (id: string) => {
    if (id === STRAWBERRIES_ID) return strawberries;
    if (id === BANANA_ID) return banana;
    throw new Error(`unexpected food id ${id}`);
  });
}

const GALLERY_URI = 'file:///picked-from-gallery.jpg';
const CAMERA_URI = 'file:///captured-with-camera.jpg';
const RESIZED_URI = 'file:///resized-background-photo.jpg';

function mockManipulate() {
  (ImageManipulator.manipulateAsync as jest.Mock).mockResolvedValue({
    uri: RESIZED_URI,
    width: 1080,
    height: 1350,
  });
}

async function setUpShareScreenWithData() {
  (listNutritionLog as jest.Mock).mockResolvedValue({ items: [entryA, entryB] });
  (getMacroGoals as jest.Mock).mockResolvedValue(GOALS);
  mockFoods();
  mockManipulate();
  const utils = await render(<NutritionShareScreen />);
  await waitFor(() => expect(utils.getByText('Today’s intake')).toBeTruthy());
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Nutrition share screen', () => {
  it('renders the Daily Summary layout by default, with the ring offset computed from totals vs goal', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [entryA, entryB] });
    (getMacroGoals as jest.Mock).mockResolvedValue(GOALS);
    mockFoods();

    const { getByText, toJSON } = await render(<NutritionShareScreen />);

    await waitFor(() => expect(getByText('600')).toBeTruthy());
    expect(getByText('/ 2000 kcal')).toBeTruthy();
    expect(getByText('Today’s intake')).toBeTruthy();

    // pct = min(1, 600/2000) = 0.3; C = 2*PI*60 (the calories ring's radius -- the outermost
    // of the four nested bands, and the first progress circle in document order); offset =
    // C*(1-0.3).
    const circles = flatten(toJSON()).filter((node) => node.type === 'RNSVGCircle');
    const progressCircle = circles.find((node) => node.props.strokeDashoffset !== undefined);
    expect(progressCircle).toBeTruthy();
    const circumference = 2 * Math.PI * 60;
    expect(Number(progressCircle?.props.strokeDashoffset)).toBeCloseTo(circumference * 0.7, 4);
  });

  it('switches to the Macro Split layout when its thumbnail is pressed, with bar widths from value/goal', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [entryA, entryB] });
    (getMacroGoals as jest.Mock).mockResolvedValue(GOALS);
    mockFoods();

    const { getByText, getByLabelText, toJSON } = await render(<NutritionShareScreen />);
    await waitFor(() => expect(getByText('Today’s intake')).toBeTruthy());

    fireEvent.press(getByLabelText('Macro Split'));

    await waitFor(() => expect(getByText('600 kcal')).toBeTruthy());
    expect(getByText('75g / 150g')).toBeTruthy();
    expect(getByText('100g / 200g')).toBeTruthy();
    expect(getByText('25g / 100g')).toBeTruthy();

    // Protein 75/150=50%, Carbs 100/200=50%, Fat 25/100=25% -- read the fill bar's own width
    // style rather than re-deriving it from the label text.
    const views = flatten(toJSON());
    const widths = views
      .map((node) => node.props.style)
      .flatMap((style) => (Array.isArray(style) ? style : [style]))
      .filter((style): style is { width?: string } => !!style && typeof style === 'object' && 'width' in style)
      .map((style) => style.width)
      .filter((width) => typeof width === 'string' && width.endsWith('%'));
    expect(widths).toEqual(expect.arrayContaining(['50%', '25%']));
  });

  it('switches to the Meal Log layout, capping the visible rows at 7 while the headline totals every item', async () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      id: `entry-${i}`,
      foodId: STRAWBERRIES_ID,
      loggedDate: TODAY,
      slot: 'snack' as const,
      servingLabel: '1 serving',
      grams: 100,
      kcal: 10,
      protein: 1,
      carbs: 1,
      fat: 1,
      groupId: null,
    }));
    (listNutritionLog as jest.Mock).mockResolvedValue({ items });
    (getMacroGoals as jest.Mock).mockResolvedValue(GOALS);
    mockFoods();

    const { getByText, getByLabelText, getAllByText } = await render(<NutritionShareScreen />);
    await waitFor(() => expect(getByText('Today’s intake')).toBeTruthy());

    fireEvent.press(getByLabelText('Meal Log'));

    await waitFor(() => expect(getByText('80 kcal total')).toBeTruthy());
    expect(getAllByText('Strawberries').length).toBe(7);
    expect(getAllByText('10 kcal').length).toBe(7);
  });

  it('fires toast confirmations for Save Image, Instagram, and More without any real device action', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [entryA, entryB] });
    (getMacroGoals as jest.Mock).mockResolvedValue(GOALS);
    mockFoods();

    const { getByText } = await render(<NutritionShareScreen />);
    await waitFor(() => expect(getByText('Today’s intake')).toBeTruthy());

    fireEvent.press(getByText('Save Image'));
    await waitFor(() => expect(getByText('Image saved to Photos')).toBeTruthy());

    fireEvent.press(getByText('Instagram'));
    await waitFor(() => expect(getByText('Sharing to Instagram…')).toBeTruthy());

    fireEvent.press(getByText('More'));
    await waitFor(() => expect(getByText('Sharing to More…')).toBeTruthy());
  });

  it('prompts to set goals first instead of dividing by a missing goal, and does not crash', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [entryA, entryB] });
    (getMacroGoals as jest.Mock).mockRejectedValue(new Error('404'));
    mockFoods();

    const { getByText, queryByText } = await render(<NutritionShareScreen />);

    await waitFor(() => expect(getByText('Set your daily goals first')).toBeTruthy());
    expect(queryByText('Today’s intake')).toBeNull();
    expect(queryByText('Choose a layout')).toBeNull();

    fireEvent.press(getByText('Set your daily goals first'));
    expect(mockPush).toHaveBeenCalledWith('/nutrition');
  });

  it('navigates back to the dashboard from the header chevron', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [] });
    (getMacroGoals as jest.Mock).mockResolvedValue(GOALS);
    mockFoods();

    const { getByLabelText, getByText } = await render(<NutritionShareScreen />);
    await waitFor(() => expect(getByText('Today’s intake')).toBeTruthy());

    fireEvent.press(getByLabelText('Back'));
    expect(mockPush).toHaveBeenCalledWith('/nutrition');
  });

  it('resolves logged item names client-side via getFood, deduplicated per food id', async () => {
    (listNutritionLog as jest.Mock).mockResolvedValue({ items: [entryA, entryB] });
    (getMacroGoals as jest.Mock).mockResolvedValue(GOALS);
    mockFoods();

    const { getByText, getByLabelText } = await render(<NutritionShareScreen />);
    await waitFor(() => expect(getByText('Today’s intake')).toBeTruthy());

    fireEvent.press(getByLabelText('Meal Log'));

    await waitFor(() => expect(getByText('Strawberries')).toBeTruthy());
    expect(getByText('Banana, raw')).toBeTruthy();
    expect(getFood).toHaveBeenCalledTimes(2);
  });

  describe('background photo picker', () => {
    it('sets the card background from the gallery when permission is granted, resizing client-side first', async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [{ uri: GALLERY_URI }],
      });

      const { getByLabelText, getByText, getByTestId, queryByTestId } = await setUpShareScreenWithData();

      expect(queryByTestId('share-card-background-photo')).toBeNull();
      fireEvent.press(getByLabelText('Background photo'));
      await waitFor(() => expect(getByText('Choose from Gallery')).toBeTruthy());
      fireEvent.press(getByText('Choose from Gallery'));

      await waitFor(() => expect(getByTestId('share-card-background-photo')).toBeTruthy());
      expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
        GALLERY_URI,
        expect.any(Array),
        expect.any(Object),
      );
      const image = getByTestId('share-card-background-photo');
      expect(image.props.source).toEqual({ uri: RESIZED_URI });
      // The sheet closes itself once a photo is picked.
      expect(queryByTestId('background-photo-sheet')).toBeNull();
    });

    it('shows a toast and keeps the gradient when gallery permission is denied', async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });

      const { getByLabelText, getByText, queryByTestId } = await setUpShareScreenWithData();

      fireEvent.press(getByLabelText('Background photo'));
      await waitFor(() => expect(getByText('Choose from Gallery')).toBeTruthy());
      fireEvent.press(getByText('Choose from Gallery'));

      await waitFor(() => expect(getByText('Photo access is needed to set a background.')).toBeTruthy());
      expect(queryByTestId('share-card-background-photo')).toBeNull();
      expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    });

    it('sets the card background from the camera when permission is granted', async () => {
      (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
      (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [{ uri: CAMERA_URI }],
      });

      const { getByLabelText, getByText, getByTestId } = await setUpShareScreenWithData();

      fireEvent.press(getByLabelText('Background photo'));
      await waitFor(() => expect(getByText('Take Photo')).toBeTruthy());
      fireEvent.press(getByText('Take Photo'));

      await waitFor(() => expect(getByTestId('share-card-background-photo')).toBeTruthy());
      expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(CAMERA_URI, expect.any(Array), expect.any(Object));
      expect(getByTestId('share-card-background-photo').props.source).toEqual({ uri: RESIZED_URI });
    });

    it('shows a toast and keeps the gradient when camera permission is denied', async () => {
      (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });

      const { getByLabelText, getByText, queryByTestId } = await setUpShareScreenWithData();

      fireEvent.press(getByLabelText('Background photo'));
      await waitFor(() => expect(getByText('Take Photo')).toBeTruthy());
      fireEvent.press(getByText('Take Photo'));

      await waitFor(() => expect(getByText('Camera access is needed to take a photo.')).toBeTruthy());
      expect(queryByTestId('share-card-background-photo')).toBeNull();
      expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    });

    it('removes the background photo and reverts to the gradient', async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [{ uri: GALLERY_URI }],
      });

      const { getByLabelText, getByText, getByTestId, queryByTestId } = await setUpShareScreenWithData();

      fireEvent.press(getByLabelText('Background photo'));
      await waitFor(() => expect(getByText('Choose from Gallery')).toBeTruthy());
      fireEvent.press(getByText('Choose from Gallery'));
      await waitFor(() => expect(getByTestId('share-card-background-photo')).toBeTruthy());

      fireEvent.press(getByLabelText('Background photo'));
      await waitFor(() => expect(getByText('Remove Photo')).toBeTruthy());
      fireEvent.press(getByText('Remove Photo'));

      await waitFor(() => expect(queryByTestId('share-card-background-photo')).toBeNull());
    });

    it('does not offer Remove Photo before any photo has been set', async () => {
      const { getByLabelText, getByText, queryByText } = await setUpShareScreenWithData();

      fireEvent.press(getByLabelText('Background photo'));

      await waitFor(() => expect(getByText('Choose from Gallery')).toBeTruthy());
      expect(getByText('Take Photo')).toBeTruthy();
      expect(queryByText('Remove Photo')).toBeNull();
    });

    it('keeps the background photo when switching layouts', async () => {
      (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
      (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [{ uri: GALLERY_URI }],
      });

      const { getByLabelText, getByText, getByTestId } = await setUpShareScreenWithData();

      fireEvent.press(getByLabelText('Background photo'));
      await waitFor(() => expect(getByText('Choose from Gallery')).toBeTruthy());
      fireEvent.press(getByText('Choose from Gallery'));
      await waitFor(() => expect(getByTestId('share-card-background-photo')).toBeTruthy());

      fireEvent.press(getByLabelText('Macro Split'));
      await waitFor(() => expect(getByText('600 kcal')).toBeTruthy());
      expect(getByTestId('share-card-background-photo').props.source).toEqual({ uri: RESIZED_URI });

      fireEvent.press(getByLabelText('Meal Log'));
      await waitFor(() => expect(getByText('600 kcal total')).toBeTruthy());
      expect(getByTestId('share-card-background-photo').props.source).toEqual({ uri: RESIZED_URI });
    });

    it('cancels out of the picker sheet without changing the background', async () => {
      const { getByLabelText, getByText, queryByTestId } = await setUpShareScreenWithData();

      fireEvent.press(getByLabelText('Background photo'));
      await waitFor(() => expect(getByText('Cancel')).toBeTruthy());
      fireEvent.press(getByText('Cancel'));

      await waitFor(() => expect(queryByTestId('background-photo-sheet')).toBeNull());
      expect(queryByTestId('share-card-background-photo')).toBeNull();
    });
  });
});
