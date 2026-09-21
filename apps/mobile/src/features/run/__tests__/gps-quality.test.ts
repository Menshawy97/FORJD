// The "GPS strong" pill on the live run screen (live run 1.png). Strong at 10 m or better, weak up to
// and beyond the 25 m the run engine itself rejects, and "searching" until the first reading arrives.
import { gpsQuality, GPS_STRONG_MAX_METERS } from '../gps-quality';

describe('gpsQuality', () => {
  it('is searching before any reading has arrived', () => {
    expect(gpsQuality(null, false)).toEqual({ level: 'searching', label: 'GPS searching' });
  });

  it('is strong at the threshold and better', () => {
    expect(gpsQuality(GPS_STRONG_MAX_METERS, true).label).toBe('GPS strong');
    expect(gpsQuality(3, true).level).toBe('strong');
  });

  it('is weak past the threshold, including readings the run will ignore', () => {
    expect(gpsQuality(10.1, true).level).toBe('weak');
    expect(gpsQuality(40, true).label).toBe('GPS weak');
  });

  it('is weak when the phone gave a reading with no accuracy, because strong cannot be claimed', () => {
    expect(gpsQuality(null, true).level).toBe('weak');
  });
});
