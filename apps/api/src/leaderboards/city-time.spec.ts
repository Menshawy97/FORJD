import { allTimeWeeks, comparisonWeekStart, monthBounds, monthWeeks, periodLabel, snapshotWeekStart, baselineNotBefore } from './city-time';

const DAY = 24 * 60 * 60 * 1000;

describe('monthBounds', () => {
  it('runs from local midnight on the 1st to local midnight on the 1st of the next month', () => {
    // Africa/Cairo is UTC+3 in September 2026 (Egypt observes summer time).
    const { start, end } = monthBounds(new Date('2026-09-15T12:00:00Z'), 'Africa/Cairo');
    expect(start.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  it('puts an instant just after local midnight into the new month even though UTC is still the old one', () => {
    // 00:30 on 1 October in Cairo is still 30 September in UTC.
    const { start } = monthBounds(new Date('2026-09-30T21:30:00Z'), 'Africa/Cairo');
    expect(start.toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  it('keeps an instant just before local midnight in the old month', () => {
    const { end } = monthBounds(new Date('2026-09-30T20:59:00Z'), 'Africa/Cairo');
    expect(end.toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  it('follows a daylight-saving change: March in New York starts at EST and ends at EDT', () => {
    const { start, end } = monthBounds(new Date('2026-03-15T12:00:00Z'), 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-01T05:00:00.000Z'); // 00:00 EST, UTC-5
    expect(end.toISOString()).toBe('2026-04-01T04:00:00.000Z'); // 00:00 EDT, UTC-4
  });

  it('handles a zone east of the date line', () => {
    const { start, end } = monthBounds(new Date('2026-09-15T00:00:00Z'), 'Pacific/Auckland');
    expect(start.toISOString()).toBe('2026-08-31T12:00:00.000Z'); // 00:00 NZST, UTC+12
    expect(end.toISOString()).toBe('2026-09-30T11:00:00.000Z'); // 00:00 NZDT, UTC+13
  });

  it('rolls December into January of the next year', () => {
    const { start, end } = monthBounds(new Date('2026-12-20T12:00:00Z'), 'UTC');
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('gives a February of 28 days in a common year and 29 in a leap year', () => {
    const common = monthBounds(new Date('2026-02-10T00:00:00Z'), 'UTC');
    const leap = monthBounds(new Date('2028-02-10T00:00:00Z'), 'UTC');
    expect((common.end.getTime() - common.start.getTime()) / DAY).toBe(28);
    expect((leap.end.getTime() - leap.start.getTime()) / DAY).toBe(29);
  });

  it('is the same whatever moment of the month it is asked', () => {
    const first = monthBounds(new Date('2026-09-01T00:00:00Z'), 'UTC');
    const last = monthBounds(new Date('2026-09-30T23:59:59Z'), 'UTC');
    expect(last).toEqual(first);
  });
});

describe('periodLabel', () => {
  it('names the month in the city, not in UTC', () => {
    // Still 30 September in UTC, already 1 October in Cairo.
    expect(periodLabel('month', new Date('2026-09-30T21:30:00Z'), 'Africa/Cairo')).toBe('Oct 2026');
    expect(periodLabel('month', new Date('2026-09-30T21:30:00Z'), 'UTC')).toBe('Sep 2026');
  });

  it('reads "all time" for the all-time board', () => {
    expect(periodLabel('all_time', new Date('2026-09-15T12:00:00Z'), 'Africa/Cairo')).toBe('all time');
  });
});

describe('monthWeeks', () => {
  const bounds = monthBounds(new Date('2026-09-15T12:00:00Z'), 'UTC');

  it('is the elapsed part of the month in weeks, so early in the month the targets are pro-rated', () => {
    expect(monthWeeks(bounds, new Date('2026-09-15T00:00:00Z'))).toBeCloseTo(14 / 7);
  });

  it('never drops below one week, however early in the month it is', () => {
    expect(monthWeeks(bounds, new Date('2026-09-01T06:00:00Z'))).toBe(1);
    expect(monthWeeks(bounds, new Date('2026-09-03T00:00:00Z'))).toBe(1);
  });

  it('stops growing at the end of the month, so a finished month is measured by its own length', () => {
    expect(monthWeeks(bounds, new Date('2026-10-20T00:00:00Z'))).toBeCloseTo(30 / 7);
  });
});

describe('allTimeWeeks', () => {
  it('is the time since the first session, in weeks', () => {
    const first = new Date('2026-06-01T00:00:00Z');
    expect(allTimeWeeks(first, new Date('2026-06-29T00:00:00Z'))).toBeCloseTo(4);
  });

  it('never drops below one week', () => {
    const first = new Date('2026-09-14T00:00:00Z');
    expect(allTimeWeeks(first, new Date('2026-09-15T00:00:00Z'))).toBe(1);
  });

  it('is one week for a session in the future, rather than negative', () => {
    expect(allTimeWeeks(new Date('2026-10-01T00:00:00Z'), new Date('2026-09-15T00:00:00Z'))).toBe(1);
  });
});

// Local midnight on the 1st can fall inside a daylight-saving gap (the clock jumps 00:00 to 01:00),
// so it does not exist. A two-pass offset guess put the month an hour early in such cases; review
// found 18 of 230,736 (zone, month) pairs wrong. These check the answer against a search that
// shares no code with the implementation: the first minute at which the zone's own calendar says
// the month has begun.
describe('monthBounds at a daylight-saving boundary', () => {
  const monthOf = (instant: number, timeZone: string): number => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' }).formatToParts(new Date(instant));
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    return get('year') * 12 + get('month') - 1;
  };

  const firstMinuteOfMonth = (year: number, month: number, timeZone: string): number => {
    const target = year * 12 + month - 1;
    const anchor = Date.UTC(year, month - 1, 1);
    for (let t = anchor - 27 * 3_600_000; t <= anchor + 27 * 3_600_000; t += 60_000) {
      if (monthOf(t, timeZone) >= target) return t;
    }
    throw new Error('no start found');
  };

  it.each([
    // Local midnight on the 1st does not exist here: the clocks skip it.
    ['America/Havana', 2012, 4],
    ['America/Asuncion', 2023, 10],
    ['America/Lima', 1990, 1],
    ['Asia/Gaza', 2004, 10],
    ['Asia/Beirut', 2020, 3],
    ['America/Sao_Paulo', 2018, 11],
    // And ordinary cases, so the search is not merely right where it is hard.
    ['Africa/Cairo', 2026, 9],
    ['America/New_York', 2026, 3],
    ['Pacific/Auckland', 2026, 9],
    ['Asia/Kolkata', 2026, 9],
    ['Pacific/Kiritimati', 2026, 9],
    ['Pacific/Pago_Pago', 2026, 9],
    ['UTC', 2026, 12],
  ])('starts %s %i-%i at the zone\'s own first minute of the month', (zone, year, month) => {
    const middle = new Date(Date.UTC(year, month - 1, 15, 12));

    const { start } = monthBounds(middle, zone);

    expect(start.getTime()).toBe(firstMinuteOfMonth(year, month, zone));
  });

  it('ends where the next month starts, so consecutive months tile with no gap and no overlap', () => {
    for (const zone of ['America/Havana', 'Asia/Gaza', 'Africa/Cairo', 'Pacific/Auckland']) {
      let previousEnd: number | null = null;
      for (let month = 1; month <= 12; month += 1) {
        const { start, end } = monthBounds(new Date(Date.UTC(2026, month - 1, 15, 12)), zone);
        if (previousEnd !== null) expect(start.getTime()).toBe(previousEnd);
        previousEnd = end.getTime();
      }
    }
  });
});

// The weekly snapshot is labelled with the local Saturday NEAREST to when the job runs (weeks start
// on Saturday, ADR-056), so every city reads it as "the state at the start of this week" however far
// from UTC it is: the job runs on Saturday 00:20 UTC, which is still Friday evening in New York and
// already Saturday afternoon in Auckland. The arrow then compares the live rank with the snapshot
// labelled one week earlier.
describe('snapshotWeekStart', () => {
  const RUN = new Date('2026-09-19T00:20:00Z'); // a Saturday, 00:20 UTC

  it.each([
    ['UTC', '2026-09-19'],
    ['Africa/Cairo', '2026-09-19'], // Saturday 03:20 local, after the Cairo week closed
    ['America/New_York', '2026-09-19'], // Friday 20:20 local, but the week that is about to start
    ['America/Los_Angeles', '2026-09-19'], // Friday 17:20 local
    ['Pacific/Auckland', '2026-09-19'], // Saturday 12:20 local
    ['Pacific/Kiritimati', '2026-09-19'], // Saturday 14:20 local
    ['Pacific/Pago_Pago', '2026-09-19'], // Friday 13:20 local
  ])('labels a Saturday 00:20 UTC run in %s as %s', (zone, expected) => {
    expect(snapshotWeekStart(RUN, zone)).toBe(expected);
  });

  it('gives a re-run a few hours later the same label, so it replaces rather than adds', () => {
    expect(snapshotWeekStart(new Date('2026-09-19T06:00:00Z'), 'Africa/Cairo')).toBe('2026-09-19');
  });

  it('moves to the next Saturday when the run is a week later', () => {
    expect(snapshotWeekStart(new Date('2026-09-26T00:20:00Z'), 'America/New_York')).toBe('2026-09-26');
  });

  it('crosses a month and a year boundary correctly', () => {
    expect(snapshotWeekStart(new Date('2026-12-26T00:20:00Z'), 'UTC')).toBe('2026-12-26');
    expect(snapshotWeekStart(new Date('2027-01-02T00:20:00Z'), 'UTC')).toBe('2027-01-02');
  });
});

describe('comparisonWeekStart', () => {
  // The baseline for "this week" is the snapshot labelled with the current local week's Saturday.
  it('is the Saturday of the current local week, whatever day of it it is', () => {
    for (const day of ['19', '20', '21', '22', '23', '24', '25']) {
      expect(comparisonWeekStart(new Date(`2026-09-${day}T12:00:00Z`), 'UTC')).toBe('2026-09-19');
    }
  });

  it("follows the city's calendar: Friday afternoon UTC is already Saturday in Auckland", () => {
    const instant = new Date('2026-09-25T13:00:00Z');
    expect(comparisonWeekStart(instant, 'UTC')).toBe('2026-09-19');
    expect(comparisonWeekStart(instant, 'Pacific/Auckland')).toBe('2026-09-26');
  });

  it('crosses a month boundary', () => {
    expect(comparisonWeekStart(new Date('2026-10-01T12:00:00Z'), 'UTC')).toBe('2026-09-26');
  });

  it('agrees with the label a run wrote, for every moment of the week that follows it', () => {
    for (const zone of ['UTC', 'Africa/Cairo', 'America/New_York', 'Pacific/Auckland']) {
      const label = snapshotWeekStart(new Date('2026-09-19T00:20:00Z'), zone);
      for (const instant of ['2026-09-19T06:00:00Z', '2026-09-22T12:00:00Z', '2026-09-24T09:00:00Z']) {
        expect(comparisonWeekStart(new Date(instant), zone)).toBe(label);
      }
    }
  });
});

describe('baselineNotBefore', () => {
  it('is two weeks before this week for all time, so a stale baseline is not shown as this week', () => {
    // Thursday 24 September 2026: this week began on Saturday the 19th.
    expect(baselineNotBefore('all_time', new Date('2026-09-24T12:00:00Z'), 'UTC')).toBe('2026-09-05');
  });

  it('is the first of the local month for a month, so two different months are never compared', () => {
    // A snapshot labelled Saturday 26 September scored September; on Thursday 1 October it is out of reach.
    expect(baselineNotBefore('month', new Date('2026-10-01T12:00:00Z'), 'UTC')).toBe('2026-10-01');
    expect(baselineNotBefore('month', new Date('2026-09-24T12:00:00Z'), 'UTC')).toBe('2026-09-01');
  });

  it("uses the city's calendar for the month", () => {
    // 22:30 UTC on 30 September is already 1 October in Auckland.
    const instant = new Date('2026-09-30T22:30:00Z');
    expect(baselineNotBefore('month', instant, 'UTC')).toBe('2026-09-01');
    expect(baselineNotBefore('month', instant, 'Pacific/Auckland')).toBe('2026-10-01');
  });

  it('is never later than the current week for a month that began mid-week', () => {
    // Saturday 26 September is inside September: a run on it may be compared with on 29 September.
    expect(baselineNotBefore('month', new Date('2026-09-29T12:00:00Z'), 'UTC') <= comparisonWeekStart(new Date('2026-09-29T12:00:00Z'), 'UTC')).toBe(true);
  });
});
