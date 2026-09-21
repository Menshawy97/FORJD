/**
 * ADR-048. The phone's coarse position, for placing an athlete on a city leaderboard.
 *
 * This file is the only place `expo-location` is touched (CLAUDE.md rule 4: integrations are
 * isolated; `check-architecture-conformance.sh` enforces it). The module is loaded lazily and
 * inside a try/catch on purpose, the same reason as the Google adapter (ADR-041): it is a native
 * module, so where it is missing (Expo Go) importing it at the top would throw at startup. A
 * failed load reports `unavailable` and reads no position, and a workout carries on without one.
 *
 * Three rules make the privacy story literally true, and each is tested:
 *
 * 1. **Permission is asked in exactly one place** (`requestCoarsePermission`, called from the
 *    Location screen). Reading a position (`readCoarsePosition`) only ever *checks* permission
 *    and never prompts, so nothing can raise a system dialog in the middle of a workout.
 * 2. **Foreground only, low accuracy.** A city needs neither a fine fix nor tracking, and the
 *    build config blocks the fine and background permissions altogether (`app.config.ts`).
 * 3. **The position is rounded to three decimal places (about 110 m) before it leaves this
 *    file**, so nothing downstream ever holds anything more precise than a city needs. The server
 *    resolves it to a city and discards it.
 *
 * **The run screen is the one exception to rules 1 to 3 (ADR-049).** While a run is open, and only
 * then, `watchPrecisePosition` follows a precise position so distance, pace and a route can be
 * measured. It is still foreground only, still never prompts (`requestPrecisePermission` is the one
 * place that does, called when a person starts a run), and the route it feeds stays on the phone: it
 * is never uploaded. The leaderboard path above is unchanged and still coarse.
 *
 * Nothing here throws into the caller. A workout must be able to start with location off, denied,
 * slow or broken (CLAUDE.md rule 6: the network, and here the GPS, is never in the critical path).
 */
export type LocationPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';
export type LocationPermissionRequest = 'granted' | 'denied' | 'unavailable';

export interface CoarsePosition {
  latitude: number;
  longitude: number;
}

/** About 110 m. Far finer than a city, and no finer than needed. */
export const COARSE_DECIMALS = 3;

/** A read that takes longer than this is abandoned: a workout must not wait on a satellite. */
export const READ_TIMEOUT_MS = 5000;

type LocationSdk = typeof import('expo-location');

let sdk: LocationSdk | null | undefined;

function loadSdk(): LocationSdk | null {
  if (sdk !== undefined) {
    return sdk;
  }
  try {
    // A guarded `require`, not `import()`: it must throw *here*, inside the try, when the native
    // module is missing, and it behaves identically under Metro and Jest.
    sdk = require('expo-location') as LocationSdk;
  } catch {
    sdk = null;
  }
  return sdk;
}

const roundCoarse = (value: number): number => {
  const factor = 10 ** COARSE_DECIMALS;
  return Math.round(value * factor) / factor;
};

const isCoordinate = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

function toPermission(status: string | undefined): LocationPermission {
  return status === 'granted' || status === 'denied' ? status : 'undetermined';
}

/** The current permission, without asking. Never prompts. */
export async function getPermissionStatus(): Promise<LocationPermission> {
  const location = loadSdk();
  if (!location) {
    return 'unavailable';
  }
  try {
    const response = await location.getForegroundPermissionsAsync();
    return toPermission(response.status);
  } catch {
    return 'unavailable';
  }
}

/**
 * Shows the system permission dialog, for foreground location only. The one place in the app
 * that may do so, called from the Location screen after the person taps "Allow Location".
 */
export async function requestCoarsePermission(): Promise<LocationPermissionRequest> {
  const location = loadSdk();
  if (!location) {
    return 'unavailable';
  }
  try {
    const response = await location.requestForegroundPermissionsAsync();
    return response.status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

/**
 * One coarse position, or null. Only reads when permission is already granted, so it can never
 * raise a dialog; gives up after `timeoutMs` so it can never hold a workout up; and never throws.
 */
export async function readCoarsePosition(timeoutMs: number = READ_TIMEOUT_MS): Promise<CoarsePosition | null> {
  const location = loadSdk();
  if (!location) {
    return null;
  }

  // The timer starts first and races the whole read, permission check included: if any native
  // call never settles, the workout still starts. (expo-location offers no way to cancel a read,
  // so one that is abandoned here keeps running until the OS settles it; its result is ignored.)
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  const read = async (): Promise<CoarsePosition | null> => {
    const permission = await location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      return null;
    }
    const fix = await location.getCurrentPositionAsync({ accuracy: location.Accuracy.Low });
    const coords = fix?.coords;
    if (!coords || !isCoordinate(coords.latitude, 90) || !isCoordinate(coords.longitude, 180)) {
      return null;
    }
    return { latitude: roundCoarse(coords.latitude), longitude: roundCoarse(coords.longitude) };
  };

  try {
    return await Promise.race([read(), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// The run screen's precise position (ADR-049).
// ---------------------------------------------------------------------------------------------

/**
 * What the person has allowed for a run. Android 12 and later let someone grant location but
 * choose "approximate", which is useless for measuring a run: it is reported as `coarse_only` so
 * the run screen can say so instead of recording nothing.
 */
export type PrecisePermission = 'granted' | 'coarse_only' | 'denied' | 'undetermined' | 'unavailable';
export type PrecisePermissionRequest = 'granted' | 'coarse_only' | 'denied' | 'unavailable';

/** One precise reading, at full precision. It never leaves the phone. */
export interface PreciseFix {
  latitude: number;
  longitude: number;
  /** Metres above sea level, or `null` when the phone gave none. */
  altitudeMeters: number | null;
  /** Horizontal accuracy radius in metres, or `null` when the phone gave none. */
  accuracyMeters: number | null;
  /** When the reading was taken, in epoch milliseconds. */
  timestampMs: number;
}

/** A running watch (`stop` is safe to call more than once), or why there is none. */
export type PreciseWatch =
  | { status: 'watching'; stop: () => void }
  | { status: 'denied' | 'coarse_only' | 'unavailable' };

/** How often the watch asks for a reading, and how far the phone must move for one (metres). */
export const PRECISE_TIME_INTERVAL_MS = 1000;
export const PRECISE_DISTANCE_INTERVAL_METERS = 2;

interface PermissionResponseLike {
  status?: string;
  android?: { accuracy?: string };
}

function toPrecisePermission(response: PermissionResponseLike): PrecisePermission {
  if (response.status !== 'granted') {
    return response.status === 'denied' ? 'denied' : 'undetermined';
  }
  return response.android?.accuracy === 'coarse' ? 'coarse_only' : 'granted';
}

/** The current precise-location permission, without asking. Never prompts. */
export async function getPrecisePermission(): Promise<PrecisePermission> {
  const location = loadSdk();
  if (!location) {
    return 'unavailable';
  }
  try {
    return toPrecisePermission(await location.getForegroundPermissionsAsync());
  } catch {
    return 'unavailable';
  }
}

/**
 * Shows the system permission dialog for foreground location. Called when a person starts a run,
 * and nowhere else in a workout: watching a position only ever checks.
 */
export async function requestPrecisePermission(): Promise<PrecisePermissionRequest> {
  const location = loadSdk();
  if (!location) {
    return 'unavailable';
  }
  try {
    const permission = toPrecisePermission(await location.requestForegroundPermissionsAsync());
    return permission === 'granted' || permission === 'coarse_only' ? permission : 'denied';
  } catch {
    return 'unavailable';
  }
}

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function toPreciseFix(reading: unknown): PreciseFix | null {
  const { coords, timestamp } = (reading ?? {}) as {
    coords?: { latitude?: unknown; longitude?: unknown; altitude?: unknown; accuracy?: unknown };
    timestamp?: unknown;
  };
  if (!coords || !isCoordinate(coords.latitude, 90) || !isCoordinate(coords.longitude, 180)) {
    return null;
  }
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    altitudeMeters: finiteOrNull(coords.altitude),
    accuracyMeters: finiteOrNull(coords.accuracy),
    timestampMs: finiteOrNull(timestamp) ?? Date.now(),
  };
}

/**
 * Follows the phone's precise position for a run and hands each valid reading to `onFix`.
 *
 * Only starts when precise foreground permission is already granted, so it can never raise a
 * dialog. Readings that are not valid coordinates are dropped, a listener that throws cannot take
 * the watch down, and nothing arrives after `stop`. It never throws: where the module or the
 * location service is missing, the result says `unavailable` and the run carries on without a route.
 */
export async function watchPrecisePosition(onFix: (fix: PreciseFix) => void): Promise<PreciseWatch> {
  const location = loadSdk();
  if (!location) {
    return { status: 'unavailable' };
  }

  try {
    const permission = toPrecisePermission(await location.getForegroundPermissionsAsync());
    if (permission === 'coarse_only') {
      return { status: 'coarse_only' };
    }
    if (permission !== 'granted') {
      return { status: 'denied' };
    }

    let stopped = false;
    const subscription = await location.watchPositionAsync(
      {
        accuracy: location.Accuracy.BestForNavigation,
        timeInterval: PRECISE_TIME_INTERVAL_MS,
        distanceInterval: PRECISE_DISTANCE_INTERVAL_METERS,
      },
      (reading) => {
        if (stopped) {
          return;
        }
        const fix = toPreciseFix(reading);
        if (!fix) {
          return;
        }
        try {
          onFix(fix);
        } catch {
          // A bug in one listener must not stop the run being followed.
        }
      },
    );

    return {
      status: 'watching',
      stop: () => {
        if (stopped) {
          return;
        }
        stopped = true;
        subscription.remove();
      },
    };
  } catch {
    return { status: 'unavailable' };
  }
}
