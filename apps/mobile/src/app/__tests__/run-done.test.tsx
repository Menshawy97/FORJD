// R7 -- the run complete screen, audited against `screenshots/run done.png` and the prototype's
// `s_runDone()` (FORJD Mobile.dc.html 2973-3006). The figures below are the screenshot's: distance
// 3.56 km, duration 22:09, pace 5:03, average HR 150, calories 298, elevation 24, and the three
// splits 5:04 / 5:11 / 5:18 with 148 / 152 / 157 bpm.
//
// NOTE: @testing-library/react-native v14 makes render() and every fireEvent.* async -- each
// returns a Promise and MUST be awaited.
import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

jest.mock('@/workouts/sync-sessions', () => ({
  syncPendingSessions: jest.fn().mockResolvedValue({ uploaded: [], failed: [] }),
  isSessionQueued: jest.fn().mockResolvedValue(true),
}));

import { clearCompletedRun, getCompletedRun, setCompletedRun, type CompletedRun } from '@/workouts/run-handoff';
import { isSessionQueued } from '@/workouts/sync-sessions';

import RunDoneScreen from '../run-done';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const SCREENSHOT_RUN: CompletedRun = {
  distanceMeters: 3560,
  movingSeconds: 1329,
  averagePaceSecondsPerKm: 303,
  avgHeartRateBpm: 150,
  caloriesKcal: 298,
  caloriesSource: 'watch',
  elevationGainMeters: 24,
  splits: [
    { index: 1, durationSeconds: 304, avgHeartRateBpm: 148 },
    { index: 2, durationSeconds: 311, avgHeartRateBpm: 152 },
    { index: 3, durationSeconds: 318, avgHeartRateBpm: 157 },
  ],
  route: [
    { latitude: 51.5, longitude: -0.12 },
    { latitude: 51.51, longitude: -0.11 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  clearCompletedRun();
  (isSessionQueued as jest.Mock).mockResolvedValue(true);
});

describe('RunDoneScreen', () => {
  it('shows the title and the offline-sync subtitle from the design while the run waits to upload', async () => {
    setCompletedRun({ ...SCREENSHOT_RUN, sessionId: 'run-1' });
    await render(<RunDoneScreen />);
    expect(screen.getByText('Run complete')).toBeTruthy();
    expect(await screen.findByText('Outdoor run · logged offline, will sync when you are back online.')).toBeTruthy();
    expect(isSessionQueued).toHaveBeenCalledWith('run-1');
  });

  // Production smoke test 2026-10-20: the summary said "logged offline" for a session already on the server.
  it('says saved once the run has uploaded', async () => {
    (isSessionQueued as jest.Mock).mockResolvedValue(false);
    setCompletedRun({ ...SCREENSHOT_RUN, sessionId: 'run-1' });
    await render(<RunDoneScreen />);
    expect(await screen.findByText('Outdoor run · saved.')).toBeTruthy();
    expect(screen.queryByText(/logged offline/)).toBeNull();
  });

  // Runs in miles (docs/product/run-miles-plan.md, replica approved 2026-10-14): the run carries the unit it was shown in.
  it('reads in miles when the run was shown in miles', async () => {
    setCompletedRun({ ...SCREENSHOT_RUN, distanceMeters: 4828.032, averagePaceSecondsPerKm: 305, elevationGainMeters: 42, unit: 'mi' });
    await render(<RunDoneScreen />);

    expect(screen.getByText('3.00')).toBeTruthy();
    expect(screen.getByText('mi')).toBeTruthy();
    expect(screen.getByText('8:11')).toBeTruthy();
    expect(screen.getByText('/mi')).toBeTruthy();
    expect(screen.getByText('138')).toBeTruthy();
    expect(screen.getByText('ft')).toBeTruthy();
    expect(screen.getByText('1 mi')).toBeTruthy();
    expect(screen.queryByText('/km')).toBeNull();
  });

  it('shows the six stat tiles with the screenshot values', async () => {
    setCompletedRun(SCREENSHOT_RUN);
    await render(<RunDoneScreen />);

    for (const label of ['Distance', 'Duration', 'Avg pace', 'Avg HR', 'Calories', 'Elevation']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('3.56')).toBeTruthy();
    expect(screen.getByText('22:09')).toBeTruthy();
    expect(screen.getByText('5:03')).toBeTruthy();
    expect(screen.getByText('150')).toBeTruthy();
    expect(screen.getByText('298')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
    for (const unit of ['km', '/km', 'bpm', 'kcal', 'm']) {
      expect(screen.getAllByText(unit).length).toBeGreaterThan(0);
    }
  });

  it('draws the splits: a km label, the pace, and the heart rate for each', async () => {
    setCompletedRun(SCREENSHOT_RUN);
    await render(<RunDoneScreen />);
    expect(screen.getByText('Splits')).toBeTruthy();
    for (const text of ['1 km', '2 km', '3 km', '5:04', '5:11', '5:18', '148 bpm', '152 bpm', '157 bpm']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it('reads a dash where a figure was never measured, never a made-up number', async () => {
    setCompletedRun({
      ...SCREENSHOT_RUN,
      avgHeartRateBpm: null,
      caloriesKcal: null,
      caloriesSource: null,
      elevationGainMeters: null,
      splits: [{ index: 1, durationSeconds: 304, avgHeartRateBpm: null }],
    });
    await render(<RunDoneScreen />);
    // Avg HR, Calories and Elevation.
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText('298')).toBeNull();
  });

  it('says calories are estimated when they are the app arithmetic and not a watch reading', async () => {
    setCompletedRun({ ...SCREENSHOT_RUN, caloriesSource: 'estimate' });
    await render(<RunDoneScreen />);
    expect(screen.getByText('estimated')).toBeTruthy();
  });

  it('explains an estimate when Health Connect refused the watch calories', async () => {
    setCompletedRun({ ...SCREENSHOT_RUN, caloriesSource: 'estimate', healthBlocked: ['active_energy'] });
    await render(<RunDoneScreen />);

    expect(
      screen.getByText('Watch calories are turned off for FORJD in Health Connect, so this run uses an estimate.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Health Connect' })).toBeTruthy();
  });

  // Walk finding 19: no weight on the account means no estimate, so the note must not claim one.
  it('does not claim an estimate when there is none', async () => {
    setCompletedRun({ ...SCREENSHOT_RUN, caloriesKcal: null, caloriesSource: null, healthBlocked: ['active_energy'] });
    await render(<RunDoneScreen />);

    expect(screen.getByText('Watch calories are turned off for FORJD in Health Connect.')).toBeTruthy();
    expect(screen.queryByText(/uses an estimate/)).toBeNull();
  });

  it('adds no health note when nothing was refused', async () => {
    setCompletedRun({ ...SCREENSHOT_RUN, caloriesSource: 'estimate', healthBlocked: [] });
    await render(<RunDoneScreen />);

    expect(screen.queryByRole('button', { name: 'Open Health Connect' })).toBeNull();
  });

  it('does not say estimated for a watch reading', async () => {
    setCompletedRun(SCREENSHOT_RUN);
    await render(<RunDoneScreen />);
    expect(screen.queryByText('estimated')).toBeNull();
  });

  it('draws the route map with the summary caption', async () => {
    setCompletedRun(SCREENSHOT_RUN);
    await render(<RunDoneScreen />);
    expect(screen.getByText('route + km markers')).toBeTruthy();
  });

  it('the check tile clears the run and goes back to Train', async () => {
    setCompletedRun(SCREENSHOT_RUN);
    await render(<RunDoneScreen />);
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(getCompletedRun()).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/train');
  });

  // The run share card (docs/product/run-share-card-plan.md, replica approved 2026-10-14) replaces 'coming soon'.
  it('the share tile opens Share Run', async () => {
    setCompletedRun(SCREENSHOT_RUN);
    await render(<RunDoneScreen />);
    await fireEvent.press(screen.getByLabelText('Share run'));
    expect(mockPush).toHaveBeenCalledWith('/run-share');
    expect(screen.queryByText('Sharing a run is coming soon')).toBeNull();
  });

  it('does not show a finished run twice, however the screen is left', async () => {
    setCompletedRun(SCREENSHOT_RUN);
    const { unmount } = await render(<RunDoneScreen />);
    await fireEvent.press(screen.getByText('View Progress'));
    await unmount();
    expect(getCompletedRun()).toBeNull();
  });

  it('View Progress goes to the Progress tab', async () => {
    setCompletedRun(SCREENSHOT_RUN);
    await render(<RunDoneScreen />);
    await fireEvent.press(screen.getByText('View Progress'));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/progress');
  });

  it('keeps Train active in the tab bar', async () => {
    setCompletedRun(SCREENSHOT_RUN);
    await render(<RunDoneScreen />);
    expect(screen.getByLabelText('Train')).toBeTruthy();
  });

  it('says so when there is no run to show, and still offers the tab bar', async () => {
    await render(<RunDoneScreen />);
    expect(screen.getByText('No run to summarise.')).toBeTruthy();
    expect(screen.getByLabelText('Train')).toBeTruthy();
  });
});
