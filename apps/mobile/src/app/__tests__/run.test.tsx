// R6 -- the live run screen, audited against `screenshots/live run 1.png`, `live run 2.png` and the
// prototype's `s_run()` (FORJD Mobile.dc.html 2914-2972), on top of the run engine (`live-run.ts`).
//
// What is real here: the engine, the snapshot codec, the formatters, the run hand-off. What is mocked
// are the I/O boundaries: the location adapter, the two SQLite stores, the network weight lookup,
// the sync queue, the router and keep-awake.
//
// NOTE: @testing-library/react-native v14 makes render() and every fireEvent.* async -- each
// returns a Promise and MUST be awaited.
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));

jest.mock('@/integrations/location/location-provider', () => ({
  ...jest.requireActual('@/integrations/location/location-provider'),
  getPrecisePermission: jest.fn(),
  requestPrecisePermission: jest.fn(),
  watchPrecisePosition: jest.fn(),
}));

jest.mock('@/store/workout-session', () => ({
  openWorkoutSessionDb: jest.fn(),
  enqueueSessionUpload: jest.fn(),
}));

jest.mock('@/store/run-session', () => ({
  ensureRunSessionSchema: jest.fn(),
  getUnfinishedRunSnapshot: jest.fn(),
  saveRunSnapshot: jest.fn(),
  clearRunSnapshot: jest.fn(),
  clearRunPoints: jest.fn(),
}));

jest.mock('@/features/run/latest-weight', () => ({ fetchLatestWeightKg: jest.fn() }));
jest.mock('@/workouts/sync-sessions', () => ({ syncPendingSessions: jest.fn() }));
jest.mock('@/store/leaderboard-consent', () => ({ readLocationConsent: jest.fn() }));

import {
  getPrecisePermission,
  requestPrecisePermission,
  watchPrecisePosition,
  type PreciseFix,
} from '@/integrations/location/location-provider';
import { toRunSnapshot } from '@/features/run/run-snapshot';
import { fetchLatestWeightKg } from '@/features/run/latest-weight';
import { clearRunSnapshot, getUnfinishedRunSnapshot, saveRunSnapshot } from '@/store/run-session';
import { readLocationConsent } from '@/store/leaderboard-consent';
import { enqueueSessionUpload, openWorkoutSessionDb } from '@/store/workout-session';
import { addFix, pauseRun, startRun } from '@/workouts/live-run';
import { clearCompletedRun, getCompletedRun } from '@/workouts/run-handoff';
import { syncPendingSessions } from '@/workouts/sync-sessions';

import RunScreen from '../run';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

const M_PER_DEG = (6_371_000 * Math.PI) / 180;
const DB = { name: 'db' };
const mockStop = jest.fn();
let deliverFix: (fix: PreciseFix) => void = () => undefined;

/** A reading `meters` north of the origin, `seconds` after `base`. */
const fixAt = (base: number, meters: number, seconds: number, accuracy: number | null = 5): PreciseFix => ({
  latitude: meters / M_PER_DEG,
  longitude: 0,
  altitudeMeters: 10,
  accuracyMeters: accuracy,
  timestampMs: base + seconds * 1000,
});

async function feed(fix: PreciseFix) {
  await act(async () => {
    deliverFix(fix);
  });
}

let appStateHandler: (state: string) => void = () => undefined;

beforeEach(() => {
  jest.clearAllMocks();
  clearCompletedRun();
  (getPrecisePermission as jest.Mock).mockResolvedValue('granted');
  (requestPrecisePermission as jest.Mock).mockResolvedValue('granted');
  (watchPrecisePosition as jest.Mock).mockImplementation(async (onFix: (fix: PreciseFix) => void) => {
    deliverFix = onFix;
    return { status: 'watching', stop: mockStop };
  });
  (openWorkoutSessionDb as jest.Mock).mockResolvedValue(DB);
  (enqueueSessionUpload as jest.Mock).mockResolvedValue(undefined);
  (getUnfinishedRunSnapshot as jest.Mock).mockResolvedValue(null);
  (saveRunSnapshot as jest.Mock).mockResolvedValue(undefined);
  (clearRunSnapshot as jest.Mock).mockResolvedValue(undefined);
  (fetchLatestWeightKg as jest.Mock).mockResolvedValue(70);
  (syncPendingSessions as jest.Mock).mockResolvedValue(undefined);
  (readLocationConsent as jest.Mock).mockResolvedValue(false);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  }) as never);
});

describe('RunScreen -- what it shows', () => {
  it('opens on a live run with nothing measured yet', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(screen.getByText('GPS searching')).toBeTruthy());

    expect(screen.getByText('Live · Outdoor run')).toBeTruthy();
    expect(screen.getByText('elapsed')).toBeTruthy();
    expect(screen.getByText('0:00')).toBeTruthy();
    for (const label of ['Distance', 'Avg pace', 'Current speed', 'Avg HR', 'Heart rate', 'Splits']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('0.00')).toBeTruthy();
    for (const unit of ['km', '/km', 'km/h', 'bpm']) {
      expect(screen.getAllByText(unit).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('live map · route + km markers')).toBeTruthy();
    expect(screen.getByText('Pause')).toBeTruthy();
    expect(screen.getByText('Finish run')).toBeTruthy();
  });

  it('shows dashes, not invented numbers, for heart rate until a watch feeds it', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(screen.getByText('GPS searching')).toBeTruthy());
    expect(screen.getByText('— bpm now')).toBeTruthy();
  });

  it('shows distance, the strong-signal pill and the first split as readings arrive', async () => {
    const base = Date.now();
    await render(<RunScreen />);
    await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());

    await feed(fixAt(base, 0, 1));
    await feed(fixAt(base, 500, 151));
    await feed(fixAt(base, 1010, 301));

    expect(screen.getByText('GPS strong')).toBeTruthy();
    expect(screen.getByText('1.01')).toBeTruthy();
    expect(screen.getByText('1 km')).toBeTruthy();
  });

  it('says the signal is weak when readings are poor', async () => {
    const base = Date.now();
    await render(<RunScreen />);
    await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());
    await feed(fixAt(base, 0, 1, 18));
    expect(screen.getByText('GPS weak')).toBeTruthy();
  });

  it('counts the elapsed time up while running', async () => {
    jest.useFakeTimers();
    try {
      await render(<RunScreen />);
      await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });
      expect(screen.getByText('0:05')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('RunScreen -- permission', () => {
  it('asks for precise location when it has not been asked, and then follows the position', async () => {
    (getPrecisePermission as jest.Mock).mockResolvedValue('undetermined');
    await render(<RunScreen />);
    await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());
    expect(requestPrecisePermission).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when it is already granted', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());
    expect(requestPrecisePermission).not.toHaveBeenCalled();
  });

  it('explains a denial and offers Open Settings, and does not start following', async () => {
    (getPrecisePermission as jest.Mock).mockResolvedValue('denied');
    (requestPrecisePermission as jest.Mock).mockResolvedValue('denied');
    await render(<RunScreen />);
    await waitFor(() => expect(screen.getByText('Location is off for FORJD')).toBeTruthy());
    expect(watchPrecisePosition).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Open Settings'));
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it('explains approximate-only location, which cannot measure a run', async () => {
    (getPrecisePermission as jest.Mock).mockResolvedValue('coarse_only');
    await render(<RunScreen />);
    await waitFor(() => expect(screen.getByText('Precise location is needed')).toBeTruthy());
    expect(watchPrecisePosition).not.toHaveBeenCalled();
  });
});

describe('RunScreen -- pause and resume', () => {
  it('pauses: the header and the button change, and readings stop counting', async () => {
    const base = Date.now();
    await render(<RunScreen />);
    await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());
    await feed(fixAt(base, 0, 1));

    await fireEvent.press(screen.getByText('Pause'));
    expect(screen.getByText('Paused · Outdoor run')).toBeTruthy();
    expect(screen.getByText('Resume run')).toBeTruthy();

    await feed(fixAt(base, 800, 200));
    expect(screen.getByText('0.00')).toBeTruthy();

    await fireEvent.press(screen.getByText('Resume run'));
    expect(screen.getByText('Live · Outdoor run')).toBeTruthy();
    expect(screen.getByText('Pause')).toBeTruthy();
  });

  it('saves its progress when paused, so a crash can recover it', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());
    await fireEvent.press(screen.getByText('Pause'));
    await waitFor(() => expect(saveRunSnapshot).toHaveBeenCalled());
  });

  it('pauses itself when the phone locks, and says why', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());
    await act(async () => {
      appStateHandler('background');
    });
    expect(screen.getByText('Paused · Outdoor run')).toBeTruthy();
    expect(screen.getByText('Paused when the phone locked. Tap Resume to carry on.')).toBeTruthy();
  });
});

describe('RunScreen -- recovering a run after the app was closed', () => {
  it('reopens a saved run paused, with what was already measured', async () => {
    const base = Date.now() - 600_000;
    let state = startRun('11111111-1111-4111-8111-111111111111', base);
    state = addFix(state, fixAt(base, 0, 1));
    state = addFix(state, fixAt(base, 100, 31));
    (getUnfinishedRunSnapshot as jest.Mock).mockResolvedValue({
      sessionId: state.id,
      payload: toRunSnapshot(pauseRun(state, base + 31_000), base + 31_000),
      startedAt: new Date(base).toISOString(),
    });

    await render(<RunScreen />);
    await waitFor(() => expect(screen.getByText('Paused · Outdoor run')).toBeTruthy());
    expect(screen.getByText('0.10')).toBeTruthy();
    expect(screen.getByText('Resume run')).toBeTruthy();
  });

  it('starts fresh when the saved run is unreadable', async () => {
    (getUnfinishedRunSnapshot as jest.Mock).mockResolvedValue({
      sessionId: 'x',
      payload: { nonsense: true },
      startedAt: new Date().toISOString(),
    });
    await render(<RunScreen />);
    await waitFor(() => expect(screen.getByText('Live · Outdoor run')).toBeTruthy());
  });
});

describe('RunScreen -- finishing', () => {
  async function runOneHundredMetres() {
    const base = Date.now();
    await render(<RunScreen />);
    await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());
    await feed(fixAt(base, 0, 1));
    await feed(fixAt(base, 100, 31));
  }

  it('offers to discard a run too short to keep, and saves nothing', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());

    await fireEvent.press(screen.getByText('Finish run'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(enqueueSessionUpload).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('queues the run for upload, clears the recovery snapshot, and opens the summary', async () => {
    await runOneHundredMetres();

    await fireEvent.press(screen.getByText('Finish run'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/run-done'));
    expect(enqueueSessionUpload).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({
        activity: 'running',
        isLiveTracked: true,
        run: expect.objectContaining({ distanceMeters: expect.any(Number) }),
      }),
    );
    const request = (enqueueSessionUpload as jest.Mock).mock.calls[0][1];
    expect(request.run.distanceMeters).toBeGreaterThan(90);
    expect(clearRunSnapshot).toHaveBeenCalled();
    expect(getCompletedRun()?.distanceMeters).toBe(request.run.distanceMeters);
    expect(syncPendingSessions).toHaveBeenCalled();
    expect(mockStop).toHaveBeenCalled();
  });

  it('keeps the route on the phone: the upload has no coordinates but the rounded start', async () => {
    (readLocationConsent as jest.Mock).mockResolvedValue(false);
    await runOneHundredMetres();
    await fireEvent.press(screen.getByText('Finish run'));
    await waitFor(() => expect(enqueueSessionUpload).toHaveBeenCalled());
    const request = (enqueueSessionUpload as jest.Mock).mock.calls[0][1];
    expect(request.startLocation).toBeNull();
    expect(JSON.stringify(request)).not.toContain('route');
  });

  it('sends the rounded start position only when leaderboard location is allowed', async () => {
    (readLocationConsent as jest.Mock).mockResolvedValue(true);
    await runOneHundredMetres();
    await fireEvent.press(screen.getByText('Finish run'));
    await waitFor(() => expect(enqueueSessionUpload).toHaveBeenCalled());
    const request = (enqueueSessionUpload as jest.Mock).mock.calls[0][1];
    expect(request.startLocation).toEqual({ latitude: expect.any(Number), longitude: expect.any(Number) });
  });

  it('never blocks on the network: no weight still saves the run, just without an estimate', async () => {
    (fetchLatestWeightKg as jest.Mock).mockResolvedValue(null);
    await runOneHundredMetres();
    await fireEvent.press(screen.getByText('Finish run'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/run-done'));
    const request = (enqueueSessionUpload as jest.Mock).mock.calls[0][1];
    expect(request.run.caloriesKcal).toBeNull();
  });

  it('stays on the run and says so when it cannot be saved on the phone', async () => {
    (enqueueSessionUpload as jest.Mock).mockRejectedValue(new Error('disk full'));
    await runOneHundredMetres();

    await fireEvent.press(screen.getByText('Finish run'));

    await waitFor(() => expect(screen.getByText('Run not saved — try Finish again.')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
    expect(clearRunSnapshot).not.toHaveBeenCalled();
  });
});

describe('RunScreen -- leaving without finishing', () => {
  it('asks before throwing a run away, and keeps it if the person says keep going', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Discard run'));

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
    expect(clearRunSnapshot).not.toHaveBeenCalled();
  });

  it('discards the run and its snapshot when confirmed', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(watchPrecisePosition).toHaveBeenCalled());
    await fireEvent.press(screen.getByLabelText('Discard run'));

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const discard = buttons.find((b) => b.text === 'Discard');
    await act(async () => {
      discard?.onPress?.();
    });

    await waitFor(() => expect(clearRunSnapshot).toHaveBeenCalled());
    expect(mockStop).toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
    expect(enqueueSessionUpload).not.toHaveBeenCalled();
  });
});
