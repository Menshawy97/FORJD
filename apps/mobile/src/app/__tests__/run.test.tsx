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
import { Alert, AppState, BackHandler, Linking } from 'react-native';
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
}));

jest.mock('@/integrations/location/run-location-task', () => ({
  startRunLocationUpdates: jest.fn(),
  stopRunLocationUpdates: jest.fn(),
  setRunFixListener: jest.fn(),
}));

jest.mock('@/store/workout-session', () => ({
  openWorkoutSessionDb: jest.fn(),
  enqueueSessionUpload: jest.fn(),
  getQueuedSessions: jest.fn(),
}));

jest.mock('@/store/run-session', () => ({
  ensureRunSessionSchema: jest.fn(),
  getUnfinishedRunSnapshot: jest.fn(),
  saveRunSnapshot: jest.fn(),
  clearRunSnapshot: jest.fn(),
}));

jest.mock('@/integrations/health/device-health-provider', () => ({ getDeviceHealthProvider: jest.fn() }));
jest.mock('@/store/health-consent-local', () => ({ readHealthConsent: jest.fn() }));
jest.mock('@/store/run-health-access', () => ({
  hasAskedRunHealthAccess: jest.fn(),
  markRunHealthAccessAsked: jest.fn(),
}));
jest.mock('@/features/run/latest-weight', () => ({ fetchRunCalorieInputs: jest.fn() }));
jest.mock('@/workouts/sync-sessions', () => ({ syncPendingSessions: jest.fn() }));
jest.mock('@/store/leaderboard-consent', () => ({ readLocationConsent: jest.fn() }));

import {
  getPrecisePermission,
  requestPrecisePermission,
  type PreciseFix,
} from '@/integrations/location/location-provider';
import { setRunFixListener, startRunLocationUpdates, stopRunLocationUpdates } from '@/integrations/location/run-location-task';
import { useKeepAwake } from 'expo-keep-awake';
import { getDeviceHealthProvider } from '@/integrations/health/device-health-provider';
import { readHealthConsent } from '@/store/health-consent-local';
import { hasAskedRunHealthAccess, markRunHealthAccessAsked } from '@/store/run-health-access';
import { toRunSnapshot } from '@/features/run/run-snapshot';
import { fetchRunCalorieInputs } from '@/features/run/latest-weight';
import { clearRunSnapshot, getUnfinishedRunSnapshot, saveRunSnapshot } from '@/store/run-session';
import { readLocationConsent } from '@/store/leaderboard-consent';
import { enqueueSessionUpload, getQueuedSessions, openWorkoutSessionDb } from '@/store/workout-session';
import { addFix, addHeartRate, pauseRun, startRun } from '@/workouts/live-run';
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
/** Which store calls ran inside `withTransactionAsync`, so the finish step's atomicity can be asserted. */
let transactionCalls: string[] | null = null;
const inTransactionLog: string[] = [];
const DB = {
  name: 'db',
  withTransactionAsync: jest.fn(async (task: () => Promise<void>) => {
    transactionCalls = [];
    try {
      await task();
      inTransactionLog.push(...transactionCalls);
    } finally {
      transactionCalls = null;
    }
  }),
};
const noteInTransaction = (name: string) => transactionCalls?.push(name);
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
  (setRunFixListener as jest.Mock).mockImplementation((listener: ((fixes: PreciseFix[]) => void) | null) => {
    deliverFix = listener ? (fix: PreciseFix) => listener([fix]) : () => undefined;
  });
  (startRunLocationUpdates as jest.Mock).mockResolvedValue('started');
  (stopRunLocationUpdates as jest.Mock).mockResolvedValue(undefined);
  (openWorkoutSessionDb as jest.Mock).mockResolvedValue(DB);
  (enqueueSessionUpload as jest.Mock).mockImplementation(() => { noteInTransaction('enqueue'); return Promise.resolve(); });
  inTransactionLog.length = 0;
  (getQueuedSessions as jest.Mock).mockResolvedValue([]);
  (getUnfinishedRunSnapshot as jest.Mock).mockResolvedValue(null);
  (saveRunSnapshot as jest.Mock).mockResolvedValue(undefined);
  (clearRunSnapshot as jest.Mock).mockImplementation(() => { noteInTransaction('clearSnapshot'); return Promise.resolve(); });
  (fetchRunCalorieInputs as jest.Mock).mockResolvedValue({ weightKg: 70, bmrKcal: null, ageYears: null, sex: null });
  (syncPendingSessions as jest.Mock).mockResolvedValue(undefined);
  (readLocationConsent as jest.Mock).mockResolvedValue(false);
  (readHealthConsent as jest.Mock).mockResolvedValue(false);
  (getDeviceHealthProvider as jest.Mock).mockReturnValue(null);
  (hasAskedRunHealthAccess as jest.Mock).mockResolvedValue(false);
  (markRunHealthAccessAsked as jest.Mock).mockResolvedValue(undefined);
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
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());

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
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    await feed(fixAt(base, 0, 1, 18));
    expect(screen.getByText('GPS weak')).toBeTruthy();
  });

  it('counts the elapsed time up while running', async () => {
    jest.useFakeTimers();
    try {
      await render(<RunScreen />);
      await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
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
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    expect(requestPrecisePermission).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when it is already granted', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    expect(requestPrecisePermission).not.toHaveBeenCalled();
  });

  it('explains a denial and offers Open Settings, and does not start following', async () => {
    (getPrecisePermission as jest.Mock).mockResolvedValue('denied');
    (requestPrecisePermission as jest.Mock).mockResolvedValue('denied');
    await render(<RunScreen />);
    await waitFor(() => expect(screen.getByText('Location is off for FORJD')).toBeTruthy());
    expect(startRunLocationUpdates).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Open Settings'));
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it('explains approximate-only location, which cannot measure a run', async () => {
    (getPrecisePermission as jest.Mock).mockResolvedValue('coarse_only');
    await render(<RunScreen />);
    await waitFor(() => expect(screen.getByText('Precise location is needed')).toBeTruthy());
    expect(startRunLocationUpdates).not.toHaveBeenCalled();
  });
});

describe('RunScreen -- pause and resume', () => {
  it('pauses: the header and the button change, and readings stop counting', async () => {
    const base = Date.now();
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
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
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    await fireEvent.press(screen.getByText('Pause'));
    await waitFor(() => expect(saveRunSnapshot).toHaveBeenCalled());
  });

  // ADR-059 (12A): the run keeps tracking through a location foreground service with the screen off.
  it('keeps running when the phone locks, and no longer says it paused', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    await act(async () => {
      appStateHandler('background');
    });
    expect(screen.getByText('Live · Outdoor run')).toBeTruthy();
    expect(screen.queryByText('Paused when the phone locked. Tap Resume to carry on.')).toBeNull();
    expect(stopRunLocationUpdates).not.toHaveBeenCalled();
  });

  it('lets the screen turn off during a run (owner decision, 12A)', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    expect(useKeepAwake).not.toHaveBeenCalled();
  });

  it('still records readings that arrive while the phone is locked', async () => {
    const base = Date.now();
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    await act(async () => {
      appStateHandler('background');
    });
    await feed(fixAt(base, 0, 1));
    await feed(fixAt(base, 100, 31));
    await act(async () => {
      appStateHandler('active');
    });
    await waitFor(() => expect(screen.getByText('0.10')).toBeTruthy());
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
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    await feed(fixAt(base, 0, 1));
    await feed(fixAt(base, 100, 31));
  }

  it('offers to discard a run too short to keep, and saves nothing', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());

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
      null,
      expect.objectContaining({
        activity: 'running',
        isLiveTracked: true,
        run: expect.objectContaining({ distanceMeters: expect.any(Number) }),
      }),
    );
    const request = (enqueueSessionUpload as jest.Mock).mock.calls[0][2];
    expect(request.run.distanceMeters).toBeGreaterThan(90);
    expect(clearRunSnapshot).toHaveBeenCalled();
    expect(getCompletedRun()?.distanceMeters).toBe(request.run.distanceMeters);
    expect(syncPendingSessions).toHaveBeenCalled();
    expect(stopRunLocationUpdates).toHaveBeenCalled();
  });

  it('keeps the route on the phone: the upload has no coordinates but the rounded start', async () => {
    (readLocationConsent as jest.Mock).mockResolvedValue(false);
    await runOneHundredMetres();
    await fireEvent.press(screen.getByText('Finish run'));
    await waitFor(() => expect(enqueueSessionUpload).toHaveBeenCalled());
    const request = (enqueueSessionUpload as jest.Mock).mock.calls[0][2];
    expect(request.startLocation).toBeNull();
    expect(JSON.stringify(request)).not.toContain('route');
  });

  it('sends the rounded start position only when leaderboard location is allowed', async () => {
    (readLocationConsent as jest.Mock).mockResolvedValue(true);
    await runOneHundredMetres();
    await fireEvent.press(screen.getByText('Finish run'));
    await waitFor(() => expect(enqueueSessionUpload).toHaveBeenCalled());
    const request = (enqueueSessionUpload as jest.Mock).mock.calls[0][2];
    expect(request.startLocation).toEqual({ latitude: expect.any(Number), longitude: expect.any(Number) });
  });

  it('never blocks on the network: no weight still saves the run, just without an estimate', async () => {
    (fetchRunCalorieInputs as jest.Mock).mockResolvedValue({ weightKg: null, bmrKcal: null, ageYears: null, sex: null });
    await runOneHundredMetres();
    await fireEvent.press(screen.getByText('Finish run'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/run-done'));
    const request = (enqueueSessionUpload as jest.Mock).mock.calls[0][2];
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

  /**
   * G6 (live-run-plan follow-up): queueing the run and clearing its crash-recovery snapshot are one
   * transaction, so a crash between them can never leave a snapshot of a run that is already
   * queued (and later uploaded) to be offered back as unfinished.
   */
  /**
   * The G6 review's race: an autosave that starts while Finish is waiting (consent, weight, the
   * watch) must not write the snapshot back -- it could land inside the finish transaction, after
   * the clear, and restore the snapshot of a queued run.
   */
  it('stops saving the recovery snapshot as soon as Finish starts, before it waits on anything', async () => {
    let releaseConsent: (value: boolean) => void = () => undefined;
    (readHealthConsent as jest.Mock).mockReturnValue(new Promise<boolean>((resolve) => (releaseConsent = resolve)));
    await runOneHundredMetres();

    await fireEvent.press(screen.getByText('Finish run'));
    (saveRunSnapshot as jest.Mock).mockClear();
    const pauseButton = screen.queryByText('Pause');
    if (pauseButton) await fireEvent.press(pauseButton);
    releaseConsent(false);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/run-done'));
    expect(saveRunSnapshot).not.toHaveBeenCalled();
  });

  it('queues the run and clears its recovery snapshot in one transaction', async () => {
    await runOneHundredMetres();

    await fireEvent.press(screen.getByText('Finish run'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/run-done'));
    expect(inTransactionLog).toEqual(['enqueue', 'clearSnapshot']);
  });

  it('says the run is not saved, and stays on it, when clearing the snapshot fails (the queueing is rolled back)', async () => {
    (clearRunSnapshot as jest.Mock).mockRejectedValue(new Error('disk I/O error'));
    await runOneHundredMetres();

    await fireEvent.press(screen.getByText('Finish run'));

    await waitFor(() => expect(screen.getByText('Run not saved — try Finish again.')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('RunScreen -- watch heart rate and calories (R8)', () => {
  /** A Health Connect stand-in that always has one reading just after the time it is asked from. */
  const watchProvider = () => ({
    source: 'health_connect',
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    getCapabilities: jest.fn(),
    requestPermissions: jest.fn().mockResolvedValue({ granted: ['heart_rate', 'active_energy'], denied: [] }),
    sync: jest.fn(async (request: { metricTypes: string[]; since: Date }) => {
      const at = new Date(request.since.getTime() + 1);
      const isHeart = request.metricTypes.includes('heart_rate');
      return {
        observations: [
          {
            metricType: isHeart ? 'heart_rate' : 'active_energy',
            value: isHeart ? 147 : 210,
            unit: isHeart ? 'bpm' : 'kcal',
            startTime: at,
            endTime: at,
            providerRecordId: null,
            deviceId: null,
            quality: null,
          },
        ],
        syncedAt: new Date(),
      };
    }),
  });

  it('does not touch Health Connect without health-data consent', async () => {
    const provider = watchProvider();
    (getDeviceHealthProvider as jest.Mock).mockReturnValue(provider);
    (readHealthConsent as jest.Mock).mockResolvedValue(false);

    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());

    expect(provider.connect).not.toHaveBeenCalled();
    expect(provider.requestPermissions).not.toHaveBeenCalled();
    expect(screen.getByText('— bpm now')).toBeTruthy();
  });

  it('asks Health Connect once on the first run and shows the heart rate that arrives', async () => {
    const provider = watchProvider();
    (getDeviceHealthProvider as jest.Mock).mockReturnValue(provider);
    (readHealthConsent as jest.Mock).mockResolvedValue(true);

    await render(<RunScreen />);

    await waitFor(() => expect(screen.getByText('147 bpm now')).toBeTruthy());
    expect(provider.requestPermissions).toHaveBeenCalledWith(['heart_rate', 'active_energy']);
    expect(markRunHealthAccessAsked).toHaveBeenCalledTimes(1);
    expect(screen.getByText('147')).toBeTruthy();
  });

  it('does not pause the run when Health Connect opens its own screen', async () => {
    const provider = watchProvider();
    let release: () => void = () => undefined;
    provider.requestPermissions.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ granted: ['heart_rate', 'active_energy'], denied: [] });
      }),
    );
    (getDeviceHealthProvider as jest.Mock).mockReturnValue(provider);
    (readHealthConsent as jest.Mock).mockResolvedValue(true);

    await render(<RunScreen />);
    await waitFor(() => expect(provider.requestPermissions).toHaveBeenCalled());
    await act(async () => {
      appStateHandler('background');
    });
    expect(screen.getByText('Live · Outdoor run')).toBeTruthy();

    await act(async () => {
      release();
    });
  });

  it('drops heart-rate samples recovered from a saved run when consent is no longer on', async () => {
    const base = Date.now() - 60_000;
    let state = startRun('11111111-1111-4111-8111-111111111111', base);
    state = addHeartRate(state, [{ timestampMs: base + 1000, bpm: 150 }]);
    (getUnfinishedRunSnapshot as jest.Mock).mockResolvedValue({
      sessionId: state.id,
      payload: toRunSnapshot(pauseRun(state, base + 5000), base + 5000),
      startedAt: new Date(base).toISOString(),
    });
    (readHealthConsent as jest.Mock).mockResolvedValue(false);

    await render(<RunScreen />);

    await waitFor(() => expect(screen.getByText('Paused · Outdoor run')).toBeTruthy());
    expect(screen.getByText('— bpm now')).toBeTruthy();
  });

  it('never asks again on a later run', async () => {
    const provider = watchProvider();
    (getDeviceHealthProvider as jest.Mock).mockReturnValue(provider);
    (readHealthConsent as jest.Mock).mockResolvedValue(true);
    (hasAskedRunHealthAccess as jest.Mock).mockResolvedValue(true);

    await render(<RunScreen />);

    await waitFor(() => expect(screen.getByText('147 bpm now')).toBeTruthy());
    expect(provider.requestPermissions).not.toHaveBeenCalled();
    expect(markRunHealthAccessAsked).not.toHaveBeenCalled();
  });

  it('uploads the watch heart rate and calories with consent', async () => {
    const provider = watchProvider();
    (getDeviceHealthProvider as jest.Mock).mockReturnValue(provider);
    (readHealthConsent as jest.Mock).mockResolvedValue(true);
    const base = Date.now();
    await render(<RunScreen />);
    await waitFor(() => expect(screen.getByText('147 bpm now')).toBeTruthy());
    await feed(fixAt(base, 0, 1));
    await feed(fixAt(base, 100, 31));

    await fireEvent.press(screen.getByText('Finish run'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/run-done'));
    const request = (enqueueSessionUpload as jest.Mock).mock.calls[0][2];
    expect(request.run.avgHeartRateBpm).toBe(147);
    expect(request.run.caloriesKcal).toBe(210);
    expect(request.run.caloriesSource).toBe('watch');
    expect(getCompletedRun()?.avgHeartRateBpm).toBe(147);
  });

  it('sends no heart rate and keeps the estimate when consent is off, even with a watch', async () => {
    (getDeviceHealthProvider as jest.Mock).mockReturnValue(watchProvider());
    (readHealthConsent as jest.Mock).mockResolvedValue(false);
    const base = Date.now();
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    await feed(fixAt(base, 0, 1));
    await feed(fixAt(base, 100, 31));

    await fireEvent.press(screen.getByText('Finish run'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/run-done'));
    const request = (enqueueSessionUpload as jest.Mock).mock.calls[0][2];
    expect(request.run.avgHeartRateBpm).toBeNull();
    expect(request.run.caloriesSource).not.toBe('watch');
  });

  it('still saves the run when Health Connect is unavailable', async () => {
    const provider = watchProvider();
    provider.connect.mockRejectedValue(new Error('not available'));
    (getDeviceHealthProvider as jest.Mock).mockReturnValue(provider);
    (readHealthConsent as jest.Mock).mockResolvedValue(true);
    const base = Date.now();
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    await feed(fixAt(base, 0, 1));
    await feed(fixAt(base, 100, 31));

    await fireEvent.press(screen.getByText('Finish run'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/run-done'));
  });
});

describe('RunScreen -- review fixes (second round)', () => {
  const finishedRun = async () => {
    const base = Date.now();
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    await feed(fixAt(base, 0, 1));
    await feed(fixAt(base, 100, 31));
  };

  it('can be finished again after a failed save', async () => {
    (enqueueSessionUpload as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await finishedRun();

    await fireEvent.press(screen.getByText('Finish run'));
    await waitFor(() => expect(screen.getByText('Run not saved — try Finish again.')).toBeTruthy());

    await fireEvent.press(screen.getByText('Finish run'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/run-done'));
    expect(enqueueSessionUpload).toHaveBeenCalledTimes(2);
  });

  it('a Pause really saves a paused snapshot, not just the one from opening', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    (saveRunSnapshot as jest.Mock).mockClear();

    await fireEvent.press(screen.getByText('Pause'));

    await waitFor(() => expect(saveRunSnapshot).toHaveBeenCalled());
    const payload = (saveRunSnapshot as jest.Mock).mock.calls[0][3] as { state: { status: string } };
    expect(payload.state.status).toBe('paused');
  });

  it('does not bring back a saved run that is already in the upload queue', async () => {
    const base = Date.now() - 60_000;
    const state = pauseRun(startRun('11111111-1111-4111-8111-111111111111', base), base + 5_000);
    (getUnfinishedRunSnapshot as jest.Mock).mockResolvedValue({
      sessionId: state.id,
      payload: toRunSnapshot(state, base + 5_000),
      startedAt: new Date(base).toISOString(),
    });
    (getQueuedSessions as jest.Mock).mockResolvedValue([{ sessionId: state.id }]);

    await render(<RunScreen />);

    await waitFor(() => expect(screen.getByText('Live · Outdoor run')).toBeTruthy());
    expect(clearRunSnapshot).toHaveBeenCalledWith(DB, state.id);
  });

  it('stops following the position when the screen is left', async () => {
    const { unmount } = await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('GPS searching')).toBeTruthy());

    await unmount();

    expect(stopRunLocationUpdates).toHaveBeenCalled();
  });

  it('says location is not available, with no Settings button that could not help', async () => {
    (getPrecisePermission as jest.Mock).mockResolvedValue('unavailable');
    await render(<RunScreen />);
    await waitFor(() => expect(screen.getByText('Location is not available')).toBeTruthy());
    expect(screen.queryByText('Open Settings')).toBeNull();
    expect(startRunLocationUpdates).not.toHaveBeenCalled();
  });
});

describe('RunScreen -- review fixes', () => {
  it('asks before discarding when the Android back button is pressed', async () => {
    let onBack: () => boolean = () => false;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_e: string, handler: () => boolean) => {
      onBack = handler;
      return { remove: jest.fn() };
    }) as never);
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());

    let handled = false;
    await act(async () => {
      handled = onBack();
    });

    expect(handled).toBe(true);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('starts following the position when location is allowed after coming back from Settings', async () => {
    (getPrecisePermission as jest.Mock).mockResolvedValue('denied');
    await render(<RunScreen />);
    await waitFor(() => expect(screen.getByText('Location is off for FORJD')).toBeTruthy());
    expect(startRunLocationUpdates).not.toHaveBeenCalled();

    (getPrecisePermission as jest.Mock).mockResolvedValue('granted');
    await act(async () => {
      appStateHandler('active');
    });

    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Location is off for FORJD')).toBeNull());
  });
});

describe('RunScreen -- reopened quickly (12A-2 review)', () => {
  /**
   * The location task and its listener are one per app. A screen that is left while its start is
   * still pending must not, when that start finally lands, stop the tracking a newer screen owns.
   */
  it("a late start from a screen already left does not stop the newer screen's tracking", async () => {
    let finishFirstStart: (value: string) => void = () => undefined;
    (startRunLocationUpdates as jest.Mock).mockImplementationOnce(
      () => new Promise<string>((resolve) => (finishFirstStart = resolve)),
    );

    const first = await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalledTimes(1));
    await first.unmount();

    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalledTimes(2));
    (setRunFixListener as jest.Mock).mockClear();
    (stopRunLocationUpdates as jest.Mock).mockClear();

    await act(async () => {
      finishFirstStart('started');
    });

    expect(setRunFixListener).not.toHaveBeenCalledWith(null);
    expect(stopRunLocationUpdates).not.toHaveBeenCalled();
  });
});

describe('RunScreen -- leaving without finishing', () => {
  it('asks before throwing a run away, and keeps it if the person says keep going', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Discard run'));

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
    expect(clearRunSnapshot).not.toHaveBeenCalled();
  });

  it('discards the run and its snapshot when confirmed', async () => {
    await render(<RunScreen />);
    await waitFor(() => expect(startRunLocationUpdates).toHaveBeenCalled());
    await fireEvent.press(screen.getByLabelText('Discard run'));

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const discard = buttons.find((b) => b.text === 'Discard');
    await act(async () => {
      discard?.onPress?.();
    });

    await waitFor(() => expect(clearRunSnapshot).toHaveBeenCalled());
    expect(stopRunLocationUpdates).toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
    expect(enqueueSessionUpload).not.toHaveBeenCalled();
  });
});
