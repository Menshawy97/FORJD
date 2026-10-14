// How a run's numbers are written on screen. The live run and the run-complete screen show the same
// figures in the same shape, so the formatting lives once, here, and is pinned against the
// screenshots: "21:27", "3.43", "5:03", "11.9".
import {
  formatDistanceKm,
  formatDuration,
  formatPace,
  formatRunDistance,
  formatRunElevation,
  formatRunPace,
  formatRunSpeed,
  formatSpeedKmh,
  RUN_UNIT_LABELS,
  splitBarPercent,
} from '../run-format';

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [65, '1:05'],
    [1287, '21:27'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [36_000, '10:00:00'],
  ])('writes %i seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('never goes negative or shows a fraction', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(59.9)).toBe('0:59');
  });

  it('shows zero for a value that is not a number', () => {
    expect(formatDuration(NaN)).toBe('0:00');
  });
});

describe('formatDistanceKm', () => {
  it.each([
    [0, '0.00'],
    [3430, '3.43'],
    [3560, '3.56'],
    [12_345.6, '12.35'],
    [999, '1.00'],
  ])('writes %f metres as %s km', (meters, expected) => {
    expect(formatDistanceKm(meters)).toBe(expected);
  });

  it('shows zero for a value that is not a number', () => {
    expect(formatDistanceKm(NaN)).toBe('0.00');
    expect(formatDistanceKm(-10)).toBe('0.00');
  });
});

describe('formatPace', () => {
  it.each([
    [303, '5:03'],
    [304.4, '5:04'],
    [359.6, '6:00'],
    [60, '1:00'],
    [3600, '60:00'],
  ])('writes %f seconds per km as %s', (seconds, expected) => {
    expect(formatPace(seconds)).toBe(expected);
  });

  it('is a dash when there is no pace yet, or it is absurd (a walk to the shop)', () => {
    expect(formatPace(null)).toBe('—');
    expect(formatPace(NaN)).toBe('—');
    expect(formatPace(Infinity)).toBe('—');
    expect(formatPace(0)).toBe('—');
    // Slower than 60 minutes a kilometre is standing still, not running.
    expect(formatPace(3601)).toBe('—');
  });
});

describe('formatSpeedKmh', () => {
  it.each([
    [3.3, '11.9'],
    [2.9167, '10.5'],
    [0, '0.0'],
  ])('writes %f m/s as %s km/h', (metersPerSecond, expected) => {
    expect(formatSpeedKmh(metersPerSecond)).toBe(expected);
  });

  it('is a dash when there is no reading yet', () => {
    expect(formatSpeedKmh(null)).toBe('—');
    expect(formatSpeedKmh(NaN)).toBe('—');
  });
});

describe('splitBarPercent', () => {
  it('makes the fastest split the longest bar and the rest proportionally shorter', () => {
    expect(splitBarPercent(304, 304)).toBe(92);
    expect(splitBarPercent(311, 304)).toBeCloseTo(92 * (304 / 311), 5);
    expect(splitBarPercent(318, 304)).toBeCloseTo(92 * (304 / 318), 5);
  });

  it('never exceeds the widest bar or drops below a visible sliver', () => {
    expect(splitBarPercent(100, 304)).toBe(92);
    expect(splitBarPercent(1_000_000, 304)).toBeGreaterThanOrEqual(4);
  });

  it('draws an empty bar for a split with no time', () => {
    expect(splitBarPercent(0, 304)).toBe(0);
    expect(splitBarPercent(NaN, 304)).toBe(0);
  });
});

// Runs in miles (docs/product/run-miles-plan.md, replica approved 2026-10-14): the same numbers in the Units choice.
// Kilometres read exactly as before.
describe('run numbers in the Units choice', () => {
  it('writes distance in km or miles to two decimals', () => {
    expect(formatRunDistance(4820, 'km')).toBe('4.82');
    expect(formatRunDistance(4828.032, 'mi')).toBe('3.00');
    expect(formatRunDistance(Number.NaN, 'mi')).toBe('0.00');
  });

  it('writes pace per km or per mile', () => {
    expect(formatRunPace(305, 'km')).toBe('5:05');
    // 305 s/km is 490.8 s/mi.
    expect(formatRunPace(305, 'mi')).toBe('8:11');
    expect(formatRunPace(null, 'mi')).toBe('—');
    expect(formatRunPace(4000, 'mi')).toBe('—');
  });

  it('writes speed in km/h or mph, and elevation in metres or feet', () => {
    expect(formatRunSpeed(3.28, 'km')).toBe('11.8');
    expect(formatRunSpeed(3.28, 'mi')).toBe('7.3');
    expect(formatRunSpeed(null, 'mi')).toBe('—');
    expect(formatRunElevation(42, 'km')).toBe('42');
    expect(formatRunElevation(42, 'mi')).toBe('138');
  });

  it('names each unit as the tiles, splits and notice show it', () => {
    expect(RUN_UNIT_LABELS.km).toEqual({ distance: 'km', pace: '/km', speed: 'km/h', elevation: 'm' });
    expect(RUN_UNIT_LABELS.mi).toEqual({ distance: 'mi', pace: '/mi', speed: 'mph', elevation: 'ft' });
  });
});
