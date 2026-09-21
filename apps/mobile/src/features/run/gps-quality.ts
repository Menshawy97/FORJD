/**
 * The pill in the corner of the live run's map ("GPS strong", `live run 1.png`). The design only
 * shows the strong state; the other two are the honest counterparts, so the pill never claims a
 * signal the phone does not have.
 *
 * Strong is a horizontal accuracy of 10 m or better. Anything worse is weak, including readings past
 * the 25 m the run engine rejects outright (`live-run.ts`, ADR-049), so the runner can see why the
 * distance is not moving. Before the first reading it is "searching". A reading with no accuracy
 * cannot be called strong.
 */
export type GpsLevel = 'searching' | 'strong' | 'weak';

export interface GpsQuality {
  level: GpsLevel;
  label: string;
}

export const GPS_STRONG_MAX_METERS = 10;

const LABELS: Record<GpsLevel, string> = {
  searching: 'GPS searching',
  strong: 'GPS strong',
  weak: 'GPS weak',
};

export function gpsQuality(latestAccuracyMeters: number | null, hasFix: boolean): GpsQuality {
  if (!hasFix) {
    return { level: 'searching', label: LABELS.searching };
  }
  const isStrong =
    latestAccuracyMeters !== null &&
    Number.isFinite(latestAccuracyMeters) &&
    latestAccuracyMeters <= GPS_STRONG_MAX_METERS;
  const level: GpsLevel = isStrong ? 'strong' : 'weak';
  return { level, label: LABELS[level] };
}
