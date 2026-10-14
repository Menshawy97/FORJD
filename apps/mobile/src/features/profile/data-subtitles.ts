import { getWorkoutStats, listBodyScans } from '@/auth/apiClient';

/**
 * Profile → Data's Workout History and InBody History subtitles (emulator walk finding 15; replica approved
 * 2026-10-14, docs/product/notifications-list-and-profile-counts-plan.md slice A). They used to be the made-up
 * "147 sessions logged" and "Last scan 8 days ago". A count that is not known yet (loading, offline, a failed request)
 * shows a neutral line, never a number.
 */
export const SESSIONS_NEUTRAL = 'Your logged sessions';
export const SCANS_NEUTRAL = 'Your InBody scans';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function sessionsSubtitle(totalSessions: number | null): string {
  if (totalSessions === null) return SESSIONS_NEUTRAL;
  return `${totalSessions} ${totalSessions === 1 ? 'session' : 'sessions'} logged`;
}

/**
 * The newest scan by day and short month ("Last scan 14 Oct"). UTC getters, like the scan history's own date
 * (`features/body/format-scan-date.ts`), so the same scan reads the same date on both screens.
 */
export function scansSubtitle(scans: ReadonlyArray<{ measuredAt: string }> | null): string {
  if (scans === null) return SCANS_NEUTRAL;
  if (scans.length === 0) return 'No scans yet';
  const times = scans.map((scan) => new Date(scan.measuredAt).getTime()).filter(Number.isFinite);
  if (times.length === 0) return SCANS_NEUTRAL;
  const newest = Math.max(...times);
  const date = new Date(newest);
  return `Last scan ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export interface DataCounts {
  totalSessions: number | null;
  scans: ReadonlyArray<{ measuredAt: string }> | null;
}

/**
 * Both reads at once; each one that fails stays unknown (null) rather than failing the other. Never throws: each call
 * starts inside a `.then`, so even a synchronous throw becomes a settled rejection.
 */
export async function loadDataCounts(): Promise<DataCounts> {
  const [stats, scans] = await Promise.allSettled([
    Promise.resolve().then(() => getWorkoutStats()),
    Promise.resolve().then(() => listBodyScans()),
  ]);
  // A response without the expected field reads as unknown too, never as a crash or a made-up number.
  const total = stats.status === 'fulfilled' ? stats.value?.totalSessions : undefined;
  const list = scans.status === 'fulfilled' ? scans.value?.scans : undefined;
  return {
    totalSessions: typeof total === 'number' ? total : null,
    scans: Array.isArray(list) ? list : null,
  };
}
