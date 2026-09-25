import { SCAN_AGE_YEARS_BOUNDS, SCAN_HEIGHT_CM_BOUNDS, type ExtractedMeasurement } from '@forjd/contracts';
import { ageInYears, shouldPrefill } from '@forjd/domain';

/**
 * Height and age on the confirm and manual screens (docs/product/scan-height-age-plan.md §3; the
 * replica was approved 2026-09-25). Both are required on every new scan. A confirmed scan takes
 * them from the sheet when it prints them, and otherwise from the profile; a manual entry starts
 * from the profile. Either way the user can edit them before saving.
 */

/** The two profile fields a scan's height and age can start from. */
export interface ProfileBasics {
  heightCm: number | null;
  dateOfBirth: string | null;
}

export type ScanProfileSource = 'sheet' | 'profile' | 'none';

/** A row's starting value, where it came from, and (for a sheet reading) its confidence bar. */
export interface ScanProfileStart {
  value: string;
  source: ScanProfileSource;
  confidence?: number;
}

export type ScanProfileField = 'heightCm' | 'ageYears';

/** The profile's age on the scan's date (not today's), or null without a date of birth. */
export function profileAgeOn(dateOfBirth: string | null, date: Date): number | null {
  return dateOfBirth === null ? null : ageInYears(dateOfBirth, date);
}

/**
 * A sheet reading wins when there is one. A confident reading is pre-filled; a doubtful one
 * starts empty with its amber bar (ADR-032: a misread is never pre-filled, and the profile does
 * not stand in for it). Only a value the sheet does not print falls back to the profile.
 */
function start(reading: ExtractedMeasurement | null, fromProfile: number | null): ScanProfileStart {
  if (reading && reading.value !== null) {
    return {
      value: shouldPrefill(reading.confidence) ? String(reading.value) : '',
      source: 'sheet',
      confidence: reading.confidence,
    };
  }
  if (fromProfile !== null) return { value: String(fromProfile), source: 'profile' };
  return { value: '', source: 'none' };
}

export function initialScanHeight(reading: ExtractedMeasurement | null, profile: ProfileBasics | null): ScanProfileStart {
  return start(reading, profile?.heightCm ?? null);
}

export function initialScanAge(
  reading: ExtractedMeasurement | null,
  profile: ProfileBasics | null,
  scanDate: Date,
): ScanProfileStart {
  return start(reading, profileAgeOn(profile?.dateOfBirth ?? null, scanDate));
}

const MISSING: Record<ScanProfileField, string> = {
  heightCm: 'Enter your height',
  ageYears: 'Enter your age',
};

/**
 * Why a row blocks saving, or null. The ranges are the request contract's own, so the app names
 * the field before the server would refuse the whole scan.
 */
export function scanProfileError(field: ScanProfileField, raw: string): string | null {
  const text = raw.trim();
  const value = text === '' ? NaN : Number(text);
  if (!Number.isFinite(value)) return MISSING[field];
  if (field === 'ageYears' && !Number.isInteger(value)) return 'Enter your age in whole years';
  const [min, max] = field === 'heightCm' ? SCAN_HEIGHT_CM_BOUNDS : SCAN_AGE_YEARS_BOUNDS;
  if (value < min || value > max) return `Must be between ${min} and ${max} ${field === 'heightCm' ? 'cm' : 'years'}`;
  return null;
}

/** Heights within this of each other are the same height, just rounded differently. */
const SAME_HEIGHT_CM = 0.5;

/** After a save: offer to update the profile when the scan's height differs from it (the user's rule). */
export function shouldOfferProfileHeight(scanHeightCm: number, profileHeightCm: number | null): boolean {
  return profileHeightCm === null || Math.abs(scanHeightCm - profileHeightCm) >= SAME_HEIGHT_CM;
}

/** "175" or "177.8": whole centimetres without a decimal, otherwise one. */
export function formatHeightCm(cm: number): string {
  const rounded = Math.round(cm * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
