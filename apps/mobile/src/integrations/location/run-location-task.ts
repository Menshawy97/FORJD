/**
 * ADR-059, Phase 12A. A run's precise position through a **location foreground service**, so it
 * keeps arriving with the screen off and the phone in a pocket.
 *
 * With the screen off, React does not drive the run: `expo-location` hands readings to a TaskManager
 * task. This file owns that task and nothing else; the run tracker (`features/run`) listens through
 * `setRunFixListener`. It is the only place `expo-task-manager` is used, and with
 * `location-provider.ts` the only place `expo-location` is (CLAUDE.md rule 4, conformance check).
 *
 * The rules ADR-049 set still hold, and each is tested:
 *
 * 1. **It never prompts.** It starts only when precise permission is already granted
 *    (`getPrecisePermission`); the one prompt stays in `requestPrecisePermission`, when a run starts.
 * 2. **Never background location.** The service runs while a run is open, started from the visible
 *    run screen, which Android counts as foreground use. `ACCESS_BACKGROUND_LOCATION` stays blocked
 *    in `app.config.ts`.
 * 3. **The route never leaves the phone.** Fixes go to the run tracker only.
 *
 * `killServiceOnDestroy`: swiping the app away stops tracking, and reopening it offers the run back
 * (crash recovery), as today. That also means no headless JavaScript ever writes a run.
 *
 * Nothing here throws into the caller (CLAUDE.md rule 6: the GPS is never in a workout's critical
 * path). The native modules are required lazily, as `location-provider.ts` does, so a build without
 * them (Expo Go) reports `unavailable` instead of crashing at startup.
 */
import { getPrecisePermission, PRECISE_TIME_INTERVAL_MS, toPreciseFix, type PreciseFix } from './location-provider';

export const RUN_LOCATION_TASK = 'forjd-run-location';

/**
 * The fixed notice Android requires for the service (the approved replica, 2026-10-03). The app's
 * name and the FORJD symbol (`androidForegroundServiceIcon`) come from the system; the live numbers
 * and buttons are a separate notification (12A-3).
 */
const SERVICE_NOTIFICATION = {
  notificationTitle: 'Location',
  notificationBody: 'Tracking your run. Tap to return.',
  killServiceOnDestroy: true,
} as const;

export type RunLocationStart = 'started' | 'denied' | 'coarse_only' | 'unavailable';
export type RunFixListener = (fixes: PreciseFix[]) => void;

/** Fixes kept while nobody listens, so none is lost between the service starting and the tracker subscribing. */
const MAX_PENDING_FIXES = 10_000;

type LocationSdk = typeof import('expo-location');
type TaskManagerSdk = typeof import('expo-task-manager');

let listener: RunFixListener | null = null;
let pending: PreciseFix[] = [];

function load<T>(name: 'expo-location' | 'expo-task-manager'): T | null {
  try {
    // A guarded `require`, not `import()`: it must throw here, inside the try, when the native module is missing.
    return (name === 'expo-location' ? require('expo-location') : require('expo-task-manager')) as T;
  } catch {
    return null;
  }
}

function deliver(fixes: PreciseFix[]): void {
  if (fixes.length === 0) return;
  if (!listener) {
    pending = [...pending, ...fixes].slice(-MAX_PENDING_FIXES);
    return;
  }
  try {
    listener(fixes);
  } catch {
    // A listener that throws must not take the service's delivery down with it.
  }
}

/**
 * Who receives the fixes. Fixes that arrived while nobody listened are handed over at once, in order.
 * `null` stops listening (the fixes after that are kept until someone listens again).
 */
export function setRunFixListener(next: RunFixListener | null): void {
  listener = next;
  if (next && pending.length > 0) {
    const waiting = pending;
    pending = [];
    deliver(waiting);
  }
}

/**
 * Registers the task with TaskManager. Safe to call more than once. It runs when this module loads
 * (below), which the app's root layout makes happen at every start of the JavaScript bundle, so a
 * process Android restarts mid-run still has the task to deliver to; and again before every start.
 */
export function defineRunLocationTask(): void {
  const taskManager = load<TaskManagerSdk>('expo-task-manager');
  if (!taskManager) return;
  try {
    if (taskManager.isTaskDefined(RUN_LOCATION_TASK)) return;
    taskManager.defineTask<{ locations?: unknown[] }>(RUN_LOCATION_TASK, async ({ data, error }) => {
      if (error) return;
      const fixes = (data?.locations ?? [])
        .map(toPreciseFix)
        .filter((fix): fix is PreciseFix => fix !== null);
      deliver(fixes);
    });
  } catch {
    // Without the task there is no screen-off tracking; the start below reports it.
  }
}

/** Starts the service for a run. Never prompts: permission must already be precise and granted. */
export async function startRunLocationUpdates(): Promise<RunLocationStart> {
  const location = load<LocationSdk>('expo-location');
  if (!location) return 'unavailable';

  const permission = await getPrecisePermission();
  if (permission === 'denied' || permission === 'coarse_only') return permission;
  if (permission !== 'granted') return permission === 'undetermined' ? 'denied' : 'unavailable';

  defineRunLocationTask();
  try {
    await location.startLocationUpdatesAsync(RUN_LOCATION_TASK, {
      accuracy: location.Accuracy.BestForNavigation,
      timeInterval: PRECISE_TIME_INTERVAL_MS,
      distanceInterval: 0,
      activityType: location.ActivityType.Fitness,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: SERVICE_NOTIFICATION,
    });
    return 'started';
  } catch {
    return 'unavailable';
  }
}

/** Stops the service. Safe to call when nothing is running, and twice. Never throws. */
export async function stopRunLocationUpdates(): Promise<void> {
  const location = load<LocationSdk>('expo-location');
  if (!location) return;
  try {
    if (await location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK)) {
      await location.stopLocationUpdatesAsync(RUN_LOCATION_TASK);
    }
  } catch {
    // Nothing to stop, or the module is gone: either way the run is over.
  }
}

// TaskManager requires the task to be defined when the bundle loads, not only when a run starts:
// after a process restart only module-scope code runs before the service delivers (12A-1 review).
defineRunLocationTask();
