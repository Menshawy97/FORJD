import { parseSheetDate } from './sheet-date';

/**
 * Device report: a sheet printed "2025.08.02" reached the confirm screen as "NaN/NaN/NaN".
 * The server now normalises dates, but the screen must never show NaN whatever arrives --
 * an unreadable date falls back to today (the user's instruction).
 */
describe('parseSheetDate', () => {
  it('reads an ISO date as that calendar day in local time, not UTC midnight', () => {
    const date = parseSheetDate('2025-08-02');
    expect(date?.getFullYear()).toBe(2025);
    expect(date?.getMonth()).toBe(7);
    expect(date?.getDate()).toBe(2);
  });

  it('also reads the dotted form the sheet prints', () => {
    expect(parseSheetDate('2025.08.02. 13:10')?.getDate()).toBe(2);
  });

  it.each([[null], [''], ['NaN'], ['2025-13-40'], ['not a date']])('returns null for %p', (raw) => {
    expect(parseSheetDate(raw)).toBeNull();
  });
});
