/**
 * How a run's numbers are written on the live run and run-complete screens (ADR-050). Pure, so the
 * two screens cannot drift apart, and pinned against the screenshots ("21:27", "3.43", "5:03",
 * "11.9"). A value that is missing or absurd is a dash or a zero, never `NaN` on a person's screen.
 */
const DASH = '—';

/** Slower than an hour a kilometre is standing still, not a pace. */
const MAX_PACE_SECONDS_PER_KM = 3600;

/** The widest a split's bar draws, as a percentage (the prototype's longest bar is 92%). */
const WIDEST_BAR_PERCENT = 92;
const NARROWEST_BAR_PERCENT = 4;

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** `m:ss`, or `h:mm:ss` from an hour up. Whole seconds; negative or non-numeric is `0:00`. */
export function formatDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${minutes}:${pad2(seconds)}`;
}

/** Kilometres to two decimals. */
export function formatDistanceKm(meters: number): string {
  const safe = Number.isFinite(meters) ? Math.max(0, meters) : 0;
  return (safe / 1000).toFixed(2);
}

/** Pace as `m:ss` per kilometre, or a dash before there is one. */
export function formatPace(secondsPerKm: number | null): string {
  if (secondsPerKm === null || !Number.isFinite(secondsPerKm)) return DASH;
  if (secondsPerKm <= 0 || secondsPerKm > MAX_PACE_SECONDS_PER_KM) return DASH;
  const rounded = Math.round(secondsPerKm);
  return `${Math.floor(rounded / 60)}:${pad2(rounded % 60)}`;
}

/** Speed in km/h to one decimal, from metres per second, or a dash before there is a reading. */
export function formatSpeedKmh(metersPerSecond: number | null): string {
  if (metersPerSecond === null || !Number.isFinite(metersPerSecond)) return DASH;
  return (Math.max(0, metersPerSecond) * 3.6).toFixed(1);
}

/** The Units distance choice a run is shown in (docs/product/run-miles-plan.md). Storage is always metres. */
export type RunUnit = 'km' | 'mi';

const METERS_PER_MILE = 1609.344;
const MPS_TO_MPH = 3600 / METERS_PER_MILE;
const FEET_PER_METER = 1 / 0.3048;

/** The unit labels the tiles, the notice and the splits show. */
export const RUN_UNIT_LABELS: Record<RunUnit, { distance: string; pace: string; speed: string; elevation: string }> = {
  km: { distance: 'km', pace: '/km', speed: 'km/h', elevation: 'm' },
  mi: { distance: 'mi', pace: '/mi', speed: 'mph', elevation: 'ft' },
};

/** Distance to two decimals, in km or miles. */
export function formatRunDistance(meters: number, unit: RunUnit): string {
  if (unit === 'km') return formatDistanceKm(meters);
  const safe = Number.isFinite(meters) ? Math.max(0, meters) : 0;
  return (safe / METERS_PER_MILE).toFixed(2);
}

/** Pace per km or per mile. The standing-still limit is judged per kilometre, whichever is shown. */
export function formatRunPace(secondsPerKm: number | null, unit: RunUnit): string {
  if (unit === 'km' || secondsPerKm === null) return formatPace(secondsPerKm);
  if (formatPace(secondsPerKm) === DASH) return DASH;
  const rounded = Math.round((secondsPerKm * METERS_PER_MILE) / 1000);
  return `${Math.floor(rounded / 60)}:${pad2(rounded % 60)}`;
}

/** Speed in km/h or mph to one decimal, or a dash before there is a reading. */
export function formatRunSpeed(metersPerSecond: number | null, unit: RunUnit): string {
  if (unit === 'km' || metersPerSecond === null || !Number.isFinite(metersPerSecond)) return formatSpeedKmh(metersPerSecond);
  return (Math.max(0, metersPerSecond) * MPS_TO_MPH).toFixed(1);
}

/** Elevation gain, whole metres or feet. */
export function formatRunElevation(meters: number, unit: RunUnit): string {
  return String(Math.round(unit === 'mi' ? meters * FEET_PER_METER : meters));
}

/**
 * A split's bar as a percentage of the track: the fastest split is the longest, the rest shorter in
 * proportion to their time, so a slower kilometre reads as a shorter bar, as in the design.
 */
export function splitBarPercent(durationSeconds: number, fastestSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  const ratio = Math.min(1, fastestSeconds / durationSeconds);
  return Math.max(NARROWEST_BAR_PERCENT, WIDEST_BAR_PERCENT * ratio);
}
