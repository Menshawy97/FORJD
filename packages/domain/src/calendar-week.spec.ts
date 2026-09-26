import { daysSinceWeekStart, isoWeekday, WEEK_START_DOW } from './calendar-week';

describe('WEEK_START_DOW', () => {
  it('is Saturday in Date#getDay() numbering (ADR-056)', () => {
    expect(WEEK_START_DOW).toBe(6);
  });
});

describe('daysSinceWeekStart', () => {
  it('puts Saturday first and Friday last', () => {
    // 0 Sun, 1 Mon, 2 Tue, 3 Wed, 4 Thu, 5 Fri, 6 Sat
    expect([6, 0, 1, 2, 3, 4, 5].map(daysSinceWeekStart)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('isoWeekday', () => {
  it('maps Sunday-first indices onto ISO 1 Monday through 7 Sunday', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(isoWeekday)).toEqual([7, 1, 2, 3, 4, 5, 6]);
  });
});
