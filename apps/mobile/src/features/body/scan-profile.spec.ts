import {
  formatHeightCm,
  initialScanAge,
  initialScanHeight,
  profileAgeOn,
  scanProfileError,
  shouldOfferProfileHeight,
} from './scan-profile';

/**
 * Height and age on the confirm and manual screens (docs/product/scan-height-age-plan.md §3,
 * replica approved 2026-09-25): where each row's starting value comes from, what blocks a save,
 * and when the profile-height prompt appears.
 */
const read = (value: number | null, confidence: number) => ({ value, confidence, readingNote: '' });
const profile = { heightCm: 175, dateOfBirth: '1994-03-12' };
const scanDate = new Date(2026, 8, 25);

describe('profileAgeOn', () => {
  it("is the profile's age on the scan date, not today", () => {
    expect(profileAgeOn('1994-03-12', new Date(2026, 8, 25))).toBe(32);
    expect(profileAgeOn('1994-03-12', new Date(2026, 1, 1))).toBe(31);
  });

  it('is null without a date of birth', () => {
    expect(profileAgeOn(null, scanDate)).toBeNull();
  });
});

describe('initialScanHeight', () => {
  it('takes a confident sheet reading, with its confidence for the bar', () => {
    expect(initialScanHeight(read(177.8, 0.96), profile)).toEqual({ value: '177.8', source: 'sheet', confidence: 0.96 });
  });

  // ADR-032: a low-confidence reading is never pre-filled, and the profile does not paper over it.
  it('starts a low-confidence sheet reading empty, keeping the amber confidence bar', () => {
    expect(initialScanHeight(read(177.8, 0.6), profile)).toEqual({ value: '', source: 'sheet', confidence: 0.6 });
  });

  it('falls back to the profile when the sheet prints no height', () => {
    expect(initialScanHeight(read(null, 0), profile)).toEqual({ value: '175', source: 'profile' });
  });

  it('uses the profile on manual entry, where nothing was read', () => {
    expect(initialScanHeight(null, profile)).toEqual({ value: '175', source: 'profile' });
  });

  it('starts empty when neither the sheet nor the profile has one', () => {
    expect(initialScanHeight(null, { heightCm: null, dateOfBirth: null })).toEqual({ value: '', source: 'none' });
    expect(initialScanHeight(null, null)).toEqual({ value: '', source: 'none' });
  });
});

describe('initialScanAge', () => {
  it('takes a confident sheet reading', () => {
    expect(initialScanAge(read(31, 0.97), profile, scanDate)).toEqual({ value: '31', source: 'sheet', confidence: 0.97 });
  });

  it('falls back to the age on the scan date from the date of birth', () => {
    expect(initialScanAge(read(null, 0), profile, scanDate)).toEqual({ value: '32', source: 'profile' });
    expect(initialScanAge(null, profile, new Date(2026, 1, 1))).toEqual({ value: '31', source: 'profile' });
  });

  it('starts empty without a date of birth', () => {
    expect(initialScanAge(null, { heightCm: 175, dateOfBirth: null }, scanDate)).toEqual({ value: '', source: 'none' });
  });
});

describe('scanProfileError', () => {
  it('asks for a missing value, like weight', () => {
    expect(scanProfileError('heightCm', '')).toBe('Enter your height');
    expect(scanProfileError('ageYears', '  ')).toBe('Enter your age');
    expect(scanProfileError('heightCm', 'abc')).toBe('Enter your height');
  });

  it("names the request contract's range", () => {
    expect(scanProfileError('heightCm', '99')).toBe('Must be between 100 and 250 cm');
    expect(scanProfileError('heightCm', '251')).toBe('Must be between 100 and 250 cm');
    expect(scanProfileError('ageYears', '15')).toBe('Must be between 16 and 110 years');
  });

  it('asks for whole years', () => {
    expect(scanProfileError('ageYears', '31.5')).toBe('Enter your age in whole years');
  });

  it('accepts a valid value', () => {
    expect(scanProfileError('heightCm', '177.8')).toBeNull();
    expect(scanProfileError('ageYears', '31')).toBeNull();
  });
});

describe('shouldOfferProfileHeight', () => {
  it('offers the update when the scan height differs from the profile', () => {
    expect(shouldOfferProfileHeight(177.8, 175)).toBe(true);
  });

  it("offers it when the profile has no height yet", () => {
    expect(shouldOfferProfileHeight(177.8, null)).toBe(true);
  });

  it('stays quiet within half a centimetre (rounding, not a different height)', () => {
    expect(shouldOfferProfileHeight(175.4, 175)).toBe(false);
    expect(shouldOfferProfileHeight(175, 175)).toBe(false);
  });
});

describe('formatHeightCm', () => {
  it('prints whole centimetres without a decimal and keeps one decimal otherwise', () => {
    expect(formatHeightCm(175)).toBe('175');
    expect(formatHeightCm(177.8)).toBe('177.8');
    expect(formatHeightCm(177.84)).toBe('177.8');
  });
});
