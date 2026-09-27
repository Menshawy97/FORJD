import {
  FORGE_DEFAULT_TIME_ZONE,
  forgeWeekStart,
  isValidTimeZone,
  nextWeekStart,
  previousWeekStart,
  weekClosesAt,
  weekDaysLeft,
} from './forge-week';

describe('FORGE_DEFAULT_TIME_ZONE', () => {
  it('is Cairo until the phone sends its own zone (ADR-057)', () => {
    expect(FORGE_DEFAULT_TIME_ZONE).toBe('Africa/Cairo');
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects anything else', () => {
    expect(isValidTimeZone('Africa/Cairo')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('forgeWeekStart', () => {
  it('is the Saturday of the local week (ADR-056)', () => {
    // Wednesday 23 September 2026, noon UTC.
    expect(forgeWeekStart(new Date('2026-09-23T12:00:00Z'), 'Africa/Cairo')).toBe('2026-09-19');
  });

  it('puts Friday 23:59 local in the closing week and Saturday 00:00 local in the next', () => {
    // Cairo is UTC+3 in September 2026 (Egyptian summer time).
    expect(forgeWeekStart(new Date('2026-09-25T20:59:00Z'), 'Africa/Cairo')).toBe('2026-09-19');
    expect(forgeWeekStart(new Date('2026-09-25T21:00:00Z'), 'Africa/Cairo')).toBe('2026-09-26');
  });

  it("follows the athlete's own zone, far east and far west", () => {
    const instant = new Date('2026-09-25T13:00:00Z'); // Friday afternoon UTC
    expect(forgeWeekStart(instant, 'Pacific/Kiritimati')).toBe('2026-09-26'); // Saturday 03:00
    expect(forgeWeekStart(instant, 'Pacific/Pago_Pago')).toBe('2026-09-19'); // Friday 02:00
  });
});

describe('weekClosesAt', () => {
  it("is the next Saturday 00:00 in the athlete's zone", () => {
    // Summer time: Saturday 00:00 in Cairo is Friday 21:00 UTC.
    expect(weekClosesAt('2026-09-19', 'Africa/Cairo').toISOString()).toBe('2026-09-25T21:00:00.000Z');
  });

  it('uses the offset in force at the close when summer time ends mid-week', () => {
    // Egypt leaves summer time at the end of the last Thursday of October (29 October 2026), so
    // the week of 24 October closes on Saturday 31 October at UTC+2.
    expect(weekClosesAt('2026-10-24', 'Africa/Cairo').toISOString()).toBe('2026-10-30T22:00:00.000Z');
  });

  it('uses the offset in force at the close when summer time starts mid-week', () => {
    // Egypt enters summer time at 00:00 on the last Friday of April (24 April 2026), so the week
    // of 18 April closes on Saturday 25 April at UTC+3.
    expect(weekClosesAt('2026-04-18', 'Africa/Cairo').toISOString()).toBe('2026-04-24T21:00:00.000Z');
  });

  it('handles a zone west of Greenwich across its autumn clock change', () => {
    // New York leaves daylight time on Sunday 1 November 2026, so the week of 24 October closes at
    // UTC-4 and the week of 31 October at UTC-5.
    expect(weekClosesAt('2026-10-24', 'America/New_York').toISOString()).toBe('2026-10-31T04:00:00.000Z');
    expect(weekClosesAt('2026-10-31', 'America/New_York').toISOString()).toBe('2026-11-07T05:00:00.000Z');
  });

  it('handles half-hour and quarter-hour offsets, including a quarter-hour zone with daylight time', () => {
    expect(weekClosesAt('2026-09-19', 'Asia/Kolkata').toISOString()).toBe('2026-09-25T18:30:00.000Z');
    // Chatham is UTC+12:45, moving to +13:45 on Sunday 27 September 2026.
    expect(weekClosesAt('2026-09-19', 'Pacific/Chatham').toISOString()).toBe('2026-09-25T11:15:00.000Z');
    expect(weekClosesAt('2026-09-26', 'Pacific/Chatham').toISOString()).toBe('2026-10-02T10:15:00.000Z');
  });

  it('is exactly seven days after the previous close outside a clock change', () => {
    const a = weekClosesAt('2026-09-12', 'Africa/Cairo').getTime();
    const b = weekClosesAt('2026-09-19', 'Africa/Cairo').getTime();
    expect(b - a).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('agrees with forgeWeekStart on both sides of the close', () => {
    for (const zone of ['Africa/Cairo', 'UTC', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const close = weekClosesAt('2026-09-19', zone).getTime();
      expect(forgeWeekStart(new Date(close - 1), zone)).toBe('2026-09-19');
      expect(forgeWeekStart(new Date(close), zone)).toBe('2026-09-26');
    }
  });

  it('rejects a week label that is not a Saturday, or not a date', () => {
    expect(() => weekClosesAt('2026-09-21', 'Africa/Cairo')).toThrow(RangeError);
    expect(() => weekClosesAt('not-a-date', 'Africa/Cairo')).toThrow(RangeError);
  });
});

describe('week arithmetic', () => {
  it('steps whole weeks across month and year boundaries', () => {
    expect(nextWeekStart('2026-12-26')).toBe('2027-01-02');
    expect(previousWeekStart('2027-01-02')).toBe('2026-12-26');
  });
});

describe('weekDaysLeft', () => {
  it('counts today as a day left, so Saturday has seven and Friday one', () => {
    expect(weekDaysLeft(new Date('2026-09-19T09:00:00Z'), 'Africa/Cairo')).toBe(7);
    expect(weekDaysLeft(new Date('2026-09-25T09:00:00Z'), 'Africa/Cairo')).toBe(1);
  });
});
