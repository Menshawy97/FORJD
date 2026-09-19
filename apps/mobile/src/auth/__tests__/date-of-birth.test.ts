import { formatDobDisplay, DOB_PLACEHOLDER, latestAllowedBirthDate, toIsoDate } from '../date-of-birth';

describe('toIsoDate', () => {
  it('reads local calendar parts, so a late-evening local date never rolls to the next day', () => {
    expect(toIsoDate(new Date(2000, 0, 5, 23, 59))).toBe('2000-01-05');
  });

  it('zero-pads month and day', () => {
    expect(toIsoDate(new Date(1999, 8, 3))).toBe('1999-09-03');
  });
});

describe('formatDobDisplay', () => {
  it('shows the design placeholder until a date is chosen', () => {
    expect(DOB_PLACEHOLDER).toBe('mm/dd/yyyy');
    expect(formatDobDisplay(null)).toBe('mm/dd/yyyy');
  });

  it('formats a chosen date as mm/dd/yyyy, matching the design screenshot', () => {
    expect(formatDobDisplay(new Date(1998, 3, 12))).toBe('04/12/1998');
  });
});

describe('latestAllowedBirthDate', () => {
  it('is the day someone born on it turns 16 today', () => {
    const today = new Date(2026, 8, 19);

    expect(toIsoDate(latestAllowedBirthDate(today))).toBe('2010-09-19');
  });

  it('keeps 29 February when today is 29 February in a leap year', () => {
    const today = new Date(2028, 1, 29);

    expect(toIsoDate(latestAllowedBirthDate(today))).toBe('2012-02-29');
  });
});
