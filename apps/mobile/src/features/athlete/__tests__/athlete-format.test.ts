import { formatClock, formatKg, formatSessionDate, recordValue, sessionLabel, sessionValue } from '../athlete-format';

describe('formatKg', () => {
  it('writes whole numbers without a decimal and adds a thousands separator', () => {
    expect(formatKg(100)).toBe('100 kg');
    expect(formatKg(14200)).toBe('14,200 kg');
  });

  it('keeps one decimal for a fractional weight', () => {
    expect(formatKg(142.5)).toBe('142.5 kg');
    expect(formatKg(142.54)).toBe('142.5 kg');
  });
});

describe('formatClock', () => {
  it('reads minutes and seconds under an hour, as the design shows a 5K', () => {
    expect(formatClock(1422)).toBe('23:42');
    expect(formatClock(59)).toBe('00:59');
  });

  it('adds hours from an hour', () => {
    expect(formatClock(3909)).toBe('1:05:09');
  });

  it('never goes negative', () => {
    expect(formatClock(-5)).toBe('00:00');
  });
});

describe('formatSessionDate', () => {
  it('is the day and short month', () => {
    // Midday UTC is the same calendar day in every timezone within 11 hours.
    expect(formatSessionDate('2026-08-19T12:00:00.000Z')).toBe('19 Aug');
    expect(formatSessionDate('2026-01-03T12:00:00.000Z')).toBe('3 Jan');
  });
});

describe('sessionValue', () => {
  it('shows kilograms when any were lifted', () => {
    expect(sessionValue({ volumeKg: 14200, durationSeconds: 3600 })).toBe('14,200 kg');
  });

  it('shows the clock for a session with no weight, such as a run', () => {
    expect(sessionValue({ volumeKg: 0, durationSeconds: 1422 })).toBe('23:42');
  });

  it('shows a dash when there is neither', () => {
    expect(sessionValue({ volumeKg: 0, durationSeconds: null })).toBe('—');
    expect(sessionValue({ volumeKg: 0, durationSeconds: 0 })).toBe('—');
  });
});

describe('labels', () => {
  it('joins a session name and date with a middle dot', () => {
    expect(sessionLabel({ name: 'Upper Body Push', startedAt: '2026-08-19T12:00:00.000Z' })).toBe(
      'Upper Body Push · 19 Aug',
    );
  });

  it('writes a record as its weight', () => {
    expect(recordValue({ weightKg: 180 })).toBe('180 kg');
  });
});
