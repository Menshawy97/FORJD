import { formatScanDate } from './format-scan-date';

describe('formatScanDate', () => {
  it('formats an ISO instant as "D MMM YYYY", matching the design', () => {
    expect(formatScanDate('2026-08-11T09:00:00.000Z')).toBe('11 Aug 2026');
  });

  it('does not zero-pad the day', () => {
    expect(formatScanDate('2026-05-01T09:00:00.000Z')).toBe('1 May 2026');
  });

  it('reads the UTC calendar date, not the local one, so it is stable across device timezones', () => {
    // 2026-01-01T00:30:00Z is still 31 Dec 2025 in any timezone behind UTC by 31+ minutes --
    // a local-getter read would show the wrong date depending on where the test runs.
    expect(formatScanDate('2026-01-01T00:30:00.000Z')).toBe('1 Jan 2026');
  });
});
