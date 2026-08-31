import { todayLocalDate } from '../date';

describe('todayLocalDate', () => {
  it('formats as YYYY-MM-DD using local getters, not UTC', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 0, 5)); // Jan 5 2026, local time

    expect(todayLocalDate()).toBe('2026-01-05');

    jest.useRealTimers();
  });

  it('pads single-digit months and days', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 1)); // Sep 1 2026

    expect(todayLocalDate()).toBe('2026-09-01');

    jest.useRealTimers();
  });
});
