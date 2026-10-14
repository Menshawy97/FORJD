// The Share Run screen (docs/product/run-share-card-plan.md; replica approved 2026-10-14): Route & Splits by default,
// Stats Card without the route, Save Image / Instagram / More through the same capture path as Share Workout, numbers
// in the run's unit, and never a heart rate or calories.
import { fireEvent, render as rtlRender, waitFor } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/** Hoisted, like workout-share.test.tsx's: a jest.mock factory may only reach `mock`-prefixed names. */
function mockShareCardShot(props: { children?: ReactNode; style?: unknown }) {
  return <View style={props.style as never}>{props.children}</View>;
}

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() } }));
jest.mock('@/media/share-capture', () => {
  class SharePermissionDeniedError extends Error {}
  return {
    saveShareCardToPhotos: jest.fn(),
    shareShareCard: jest.fn(),
    isExpoGo: jest.fn().mockReturnValue(false),
    SharePermissionDeniedError,
  };
});
jest.mock('@/media/share-card-shot', () => ({ ShareCardShot: mockShareCardShot }));

import { saveShareCardToPhotos, shareShareCard } from '@/media/share-capture';
import { clearCompletedRun, setCompletedRun, type CompletedRun } from '@/workouts/run-handoff';

import RunShareScreen from '../run-share';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const render = (ui: ReactElement) => rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

const RUN: CompletedRun = {
  distanceMeters: 4820,
  movingSeconds: 1471,
  averagePaceSecondsPerKm: 305,
  avgHeartRateBpm: 150,
  caloriesKcal: 298,
  caloriesSource: 'watch',
  elevationGainMeters: 42,
  splits: [
    { index: 1, durationSeconds: 312, avgHeartRateBpm: 148 },
    { index: 2, durationSeconds: 298, avgHeartRateBpm: 152 },
    { index: 3, durationSeconds: 303, avgHeartRateBpm: 155 },
    { index: 4, durationSeconds: 301, avgHeartRateBpm: 157 },
    { index: 5, durationSeconds: 299, avgHeartRateBpm: 158 },
    { index: 6, durationSeconds: 296, avgHeartRateBpm: 160 },
  ],
  route: [
    { latitude: 30.0, longitude: 31.2 },
    { latitude: 30.01, longitude: 31.21 },
    { latitude: 30.02, longitude: 31.2 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  clearCompletedRun();
});

describe('Share Run', () => {
  it('opens on Route & Splits: the route line, the numbers and up to five splits', async () => {
    setCompletedRun(RUN);
    const screen = await render(<RunShareScreen />);

    screen.getByText('Share Run');
    screen.getByTestId('share-route-line');
    screen.getByText('Outdoor Run');
    screen.getByText('Today · 4.82 km');
    screen.getByText('24:31');
    screen.getByText('5:05 /km');
    screen.getByText('42 m');
    screen.getByText('5 km');
    expect(screen.queryByText('6 km')).toBeNull();
  });

  it('never puts heart rate or calories on the card', async () => {
    setCompletedRun(RUN);
    const screen = await render(<RunShareScreen />);

    expect(screen.queryByText(/bpm/)).toBeNull();
    expect(screen.queryByText(/kcal|298/)).toBeNull();
  });

  it('offers a Stats Card with no route and no splits', async () => {
    setCompletedRun(RUN);
    const screen = await render(<RunShareScreen />);

    await fireEvent.press(screen.getByLabelText('Use the Stats Card layout'));

    expect(screen.queryByTestId('share-route-line')).toBeNull();
    expect(screen.queryByText('1 km')).toBeNull();
    screen.getByText('5:05 /km');
  });

  it('reads in miles when the run was shown in miles', async () => {
    setCompletedRun({ ...RUN, distanceMeters: 4828.032, unit: 'mi', splits: RUN.splits.slice(0, 3) });
    const screen = await render(<RunShareScreen />);

    screen.getByText('Today · 3.00 mi');
    screen.getByText('8:11 /mi');
    screen.getByText('138 ft');
    screen.getByText('1 mi');
  });

  it('saves and shares the card through the same capture path as Share Workout', async () => {
    setCompletedRun(RUN);
    const screen = await render(<RunShareScreen />);

    await fireEvent.press(screen.getByLabelText('Save Image'));
    await waitFor(() => expect(saveShareCardToPhotos).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByLabelText('More'));
    await waitFor(() => expect(shareShareCard).toHaveBeenCalledTimes(1));
  });

  it('says there is nothing to share without a finished run', async () => {
    const screen = await render(<RunShareScreen />);

    screen.getByText('Finish a run to share it.');
  });
});
