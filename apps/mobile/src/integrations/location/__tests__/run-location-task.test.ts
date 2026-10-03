// ADR-059, Phase 12A-1. A run's position through a location foreground service, so it keeps coming
// with the screen off. Both native modules are mocked at their boundary; what is proven is the
// adapter's own behaviour: it starts only with precise permission already granted and never prompts,
// asks for exactly the foreground service ADR-059 describes (never background location), passes on
// only valid fixes, keeps fixes that arrive before anyone listens, and never throws.
const mockGetPermissions = jest.fn();
const mockStartUpdates = jest.fn();
const mockStopUpdates = jest.fn();
const mockHasStarted = jest.fn();
const mockDefineTask = jest.fn();
const mockIsTaskDefined = jest.fn();

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
  startLocationUpdatesAsync: (...args: unknown[]) => mockStartUpdates(...args),
  stopLocationUpdatesAsync: (...args: unknown[]) => mockStopUpdates(...args),
  hasStartedLocationUpdatesAsync: (...args: unknown[]) => mockHasStarted(...args),
  Accuracy: { Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: (...args: unknown[]) => mockDefineTask(...args),
  isTaskDefined: (...args: unknown[]) => mockIsTaskDefined(...args),
}));

import {
  RUN_LOCATION_TASK,
  defineRunLocationTask,
  setRunFixListener,
  startRunLocationUpdates,
  stopRunLocationUpdates,
} from '../run-location-task';

const grantedFine = { status: 'granted', granted: true, android: { accuracy: 'fine' } };
const grantedCoarse = { status: 'granted', granted: true, android: { accuracy: 'coarse' } };
const denied = { status: 'denied', granted: false };

const reading = (latitude: number, timestamp = 1_700_000_000_000) => ({
  coords: { latitude, longitude: 29.91, altitude: 12, accuracy: 5 },
  timestamp,
});

/** The executor the adapter registered with TaskManager, as TaskManager would call it. */
function registeredExecutor(): (body: { data?: unknown; error?: unknown }) => Promise<void> | void {
  const call = mockDefineTask.mock.calls.find(([name]) => name === RUN_LOCATION_TASK);
  if (!call) throw new Error('task not defined');
  return call[1];
}

describe('run location task (ADR-059)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsTaskDefined.mockReturnValue(false);
    mockHasStarted.mockResolvedValue(false);
    setRunFixListener(null);
  });

  describe('startRunLocationUpdates', () => {
    it('starts the foreground service with the approved notice and never background location', async () => {
      mockGetPermissions.mockResolvedValue(grantedFine);

      await expect(startRunLocationUpdates()).resolves.toBe('started');

      expect(mockStartUpdates).toHaveBeenCalledWith(RUN_LOCATION_TASK, {
        accuracy: 6,
        timeInterval: 1000,
        distanceInterval: 0,
        activityType: 3,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Location',
          notificationBody: 'Tracking your run. Tap to return.',
          killServiceOnDestroy: true,
        },
      });
    });

    it('defines the task before starting, so the service has somewhere to deliver fixes', async () => {
      mockGetPermissions.mockResolvedValue(grantedFine);

      await startRunLocationUpdates();

      expect(mockDefineTask).toHaveBeenCalledWith(RUN_LOCATION_TASK, expect.any(Function));
      expect(mockDefineTask.mock.invocationCallOrder[0]).toBeLessThan(mockStartUpdates.mock.invocationCallOrder[0] ?? 0);
    });

    it.each([
      ['denied', denied],
      ['coarse_only', grantedCoarse],
    ])('does not start, and never prompts, when permission is %s', async (expected, permission) => {
      mockGetPermissions.mockResolvedValue(permission);

      await expect(startRunLocationUpdates()).resolves.toBe(expected);

      expect(mockStartUpdates).not.toHaveBeenCalled();
    });

    it('reports unavailable rather than throwing when the service cannot start', async () => {
      mockGetPermissions.mockResolvedValue(grantedFine);
      mockStartUpdates.mockRejectedValue(new Error('Foreground service cannot be started'));

      await expect(startRunLocationUpdates()).resolves.toBe('unavailable');
    });
  });

  describe('stopRunLocationUpdates', () => {
    it('stops a running service', async () => {
      mockHasStarted.mockResolvedValue(true);

      await stopRunLocationUpdates();

      expect(mockStopUpdates).toHaveBeenCalledWith(RUN_LOCATION_TASK);
    });

    it('is safe to call when nothing is running, and twice', async () => {
      await stopRunLocationUpdates();
      await stopRunLocationUpdates();

      expect(mockStopUpdates).not.toHaveBeenCalled();
    });

    it('never throws', async () => {
      mockHasStarted.mockRejectedValue(new Error('boom'));

      await expect(stopRunLocationUpdates()).resolves.toBeUndefined();
    });
  });

  describe('fixes delivered by the task', () => {
    beforeEach(() => {
      defineRunLocationTask();
    });

    it('passes on valid fixes at full precision, in order', async () => {
      const listener = jest.fn();
      setRunFixListener(listener);

      await registeredExecutor()({ data: { locations: [reading(31.2000001, 1), reading(31.2000002, 2)] } });

      expect(listener).toHaveBeenCalledWith([
        { latitude: 31.2000001, longitude: 29.91, altitudeMeters: 12, accuracyMeters: 5, timestampMs: 1 },
        { latitude: 31.2000002, longitude: 29.91, altitudeMeters: 12, accuracyMeters: 5, timestampMs: 2 },
      ]);
    });

    it('drops readings that are not valid coordinates', async () => {
      const listener = jest.fn();
      setRunFixListener(listener);

      await registeredExecutor()({ data: { locations: [reading(91), { coords: null }, reading(31.2)] } });

      expect(listener).toHaveBeenCalledWith([expect.objectContaining({ latitude: 31.2 })]);
    });

    it('ignores an error from the service and a delivery with no readings', async () => {
      const listener = jest.fn();
      setRunFixListener(listener);

      await registeredExecutor()({ error: { message: 'location off' } });
      await registeredExecutor()({ data: { locations: [] } });

      expect(listener).not.toHaveBeenCalled();
    });

    it('keeps fixes that arrive before anyone listens, and hands them over in order', async () => {
      await registeredExecutor()({ data: { locations: [reading(31.1, 1)] } });
      const listener = jest.fn();

      setRunFixListener(listener);

      expect(listener).toHaveBeenCalledWith([expect.objectContaining({ latitude: 31.1, timestampMs: 1 })]);
    });

    it('survives a listener that throws', async () => {
      setRunFixListener(() => {
        throw new Error('listener broke');
      });

      await expect(registeredExecutor()({ data: { locations: [reading(31.2)] } })).resolves.toBeUndefined();
    });

    it('defines the task only once', () => {
      mockIsTaskDefined.mockReturnValue(true);
      mockDefineTask.mockClear();

      defineRunLocationTask();

      expect(mockDefineTask).not.toHaveBeenCalled();
    });
  });
});
