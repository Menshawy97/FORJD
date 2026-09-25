import type { ExtractedMeasurement } from '@forjd/contracts';
import { useEffect, useState } from 'react';

import { getMe } from '@/auth/apiClient';

import {
  formatHeightCm,
  initialScanAge,
  initialScanHeight,
  profileAgeOn,
  scanProfileError,
  shouldOfferProfileHeight,
  type ProfileBasics,
  type ScanProfileField,
  type ScanProfileStart,
} from './scan-profile';
import { ScanValueRow } from './scan-value-row';

/** The sheet's readings on Confirm scan; absent on manual entry, where nothing was read. */
export interface SheetProfileReadings {
  heightCm: ExtractedMeasurement;
  ageYears: ExtractedMeasurement;
}

interface Row {
  start: ScanProfileStart;
  text: string;
  /** The user typed in this row: its value is theirs now, not the sheet's or the profile's. */
  edited: boolean;
}

const EMPTY_ROW: Row = { start: { value: '', source: 'none' }, text: '', edited: false };

/**
 * Height and age for one scan being saved (docs/product/scan-height-age-plan.md §3). Loads the
 * profile once, starts each row from the sheet or the profile (`scan-profile.ts`), and keeps an
 * age that came from the profile in step with the scan's date until the user edits it.
 *
 * `ready` is false until the caller knows its sheet readings (Confirm scan takes its pending scan
 * on focus), so the rows start from the right source instead of flashing the profile first.
 */
export function useScanProfile(readings: SheetProfileReadings | null, scanDate: Date, ready: boolean) {
  const [profile, setProfile] = useState<ProfileBasics | null | undefined>(undefined);
  const [height, setHeight] = useState<Row>(EMPTY_ROW);
  const [age, setAge] = useState<Row>(EMPTY_ROW);
  const [started, setStarted] = useState(false);
  const [profileUnavailable, setProfileUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMe().then(
      (me) => {
        if (!cancelled) setProfile(me.profile ? { heightCm: me.profile.heightCm, dateOfBirth: me.profile.dateOfBirth } : null);
      },
      // Without the profile the rows start from the sheet or empty; the user can still type them.
      () => {
        if (cancelled) return;
        setProfile(null);
        setProfileUnavailable(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (started || !ready || profile === undefined) return;
    const heightStart = initialScanHeight(readings?.heightCm ?? null, profile);
    const ageStart = initialScanAge(readings?.ageYears ?? null, profile, scanDate);
    setHeight({ start: heightStart, text: heightStart.value, edited: false });
    setAge({ start: ageStart, text: ageStart.value, edited: false });
    setStarted(true);
  }, [started, ready, profile, readings, scanDate]);

  // An age that came from the date of birth follows the scan's date, until the user edits it.
  const scanDay = scanDate.toDateString();
  useEffect(() => {
    if (!started || age.start.source !== 'profile' || age.edited) return;
    const next = profileAgeOn(profile?.dateOfBirth ?? null, scanDate);
    if (next !== null && String(next) !== age.text) setAge((row) => ({ ...row, text: String(next) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the calendar day, not the Date object
  }, [scanDay, started]);

  const errors = (): Partial<Record<ScanProfileField, string>> => {
    const found: Partial<Record<ScanProfileField, string>> = {};
    const heightError = scanProfileError('heightCm', height.text);
    const ageError = scanProfileError('ageYears', age.text);
    if (heightError) found.heightCm = heightError;
    if (ageError) found.ageYears = ageError;
    return found;
  };

  return {
    height,
    age,
    setHeightText: (text: string) => setHeight((row) => ({ ...row, text, edited: true })),
    setAgeText: (text: string) => setAge((row) => ({ ...row, text, edited: true })),
    errors,
    /**
     * After a save: the InBody screen's "update your profile height?" prompt, as route params, or
     * null when the heights match (or the profile could not be read, so nothing is known to differ).
     */
    heightPromptParams: (savedHeightCm: number): { heightPrompt: string; profileHeight: string } | null => {
      if (profileUnavailable) return null;
      const profileHeightCm = profile?.heightCm ?? null;
      if (!shouldOfferProfileHeight(savedHeightCm, profileHeightCm)) return null;
      return {
        heightPrompt: formatHeightCm(savedHeightCm),
        profileHeight: profileHeightCm === null ? '' : formatHeightCm(profileHeightCm),
      };
    },
  };
}

interface ScanProfileRowsProps {
  mode: 'confirm' | 'manual';
  scanProfile: ReturnType<typeof useScanProfile>;
  errors: Partial<Record<ScanProfileField, string>>;
  onEdit: (field: ScanProfileField) => void;
}

/**
 * The two required rows at the top of the values (replica approved 2026-09-25). On Confirm scan a
 * sheet reading carries its confidence bar and a value taken from the profile stays amber until
 * the user touches it; on manual entry both are marked Required and say they came from the profile.
 */
export function ScanProfileRows({ mode, scanProfile, errors, onEdit }: ScanProfileRowsProps) {
  const row = (field: ScanProfileField, label: string, unit: string, state: Row, set: (text: string) => void) => {
    const fromProfile = state.start.source === 'profile';
    return (
      <ScanValueRow
        label={label}
        unit={unit}
        value={state.text}
        onChange={(text) => {
          set(text);
          onEdit(field);
        }}
        confidence={state.start.source === 'sheet' ? state.start.confidence : undefined}
        required={mode === 'manual'}
        hint={fromProfile ? (mode === 'confirm' ? 'Not on the sheet: from your profile. Please check.' : 'From your profile') : undefined}
        checkMe={mode === 'confirm' && fromProfile && !state.edited}
        error={errors[field]}
      />
    );
  };

  return (
    <>
      {row('heightCm', 'Height', 'cm', scanProfile.height, scanProfile.setHeightText)}
      {row('ageYears', 'Age', 'years', scanProfile.age, scanProfile.setAgeText)}
    </>
  );
}
