import { existsSync } from 'fs';
import { join } from 'path';

import { NORMALIZED_COLUMNS } from './ingest/normalize-cities';
import { CITY_SNAPSHOT_PATH, loadCitySnapshotFromDisk, validateCitySnapshot } from './city-snapshot';

const valid = () => ({
  source: 'test',
  pin: 'sha256:abc',
  count: 2,
  dropped: { noSlug: 0, orphanSection: 0 },
  columns: [...NORMALIZED_COLUMNS],
  timezones: ['Africa/Cairo', 'Europe/Rome'],
  rows: [
    [1, 'Cairo', 'EG', 30.06, 31.25, 9_606_916, 0, 'cairo-eg-1'],
    [2, 'Rome', 'IT', 41.89, 12.48, 2_872_800, 1, 'rome-it-2'],
  ],
});

describe('validateCitySnapshot', () => {
  it('accepts a well-formed snapshot and returns it', () => {
    expect(validateCitySnapshot(valid()).count).toBe(2);
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an array', []],
  ])('rejects %s', (_label, input) => {
    expect(() => validateCitySnapshot(input)).toThrow(/not an object/);
  });

  it('rejects a snapshot whose columns are not the ones this code reads', () => {
    expect(() => validateCitySnapshot({ ...valid(), columns: ['a', 'b'] })).toThrow(/columns/);
  });

  it('rejects a truncated snapshot whose count no longer matches its rows', () => {
    const snap = valid();
    expect(() => validateCitySnapshot({ ...snap, rows: snap.rows.slice(0, 1) })).toThrow(/count/);
  });

  it('rejects rows or timezones that are not arrays', () => {
    expect(() => validateCitySnapshot({ ...valid(), rows: 'x' })).toThrow(/rows/);
    expect(() => validateCitySnapshot({ ...valid(), timezones: 'x' })).toThrow(/timezones/);
  });

  it('rejects a row that is the wrong width', () => {
    const snap = valid();
    expect(() => validateCitySnapshot({ ...snap, rows: [[1, 'Cairo'], snap.rows[1]] })).toThrow(/row 0/);
  });

  it('rejects a row with a wrongly typed field', () => {
    const snap = valid();
    const bad = [...(snap.rows[0] as unknown[])];
    bad[3] = 'thirty';
    expect(() => validateCitySnapshot({ ...snap, rows: [bad, snap.rows[1]] })).toThrow(/row 0/);
  });

  it('rejects a timezone index that points nowhere', () => {
    const snap = valid();
    const bad = [...(snap.rows[0] as unknown[])];
    bad[6] = 9;
    expect(() => validateCitySnapshot({ ...snap, rows: [bad, snap.rows[1]] })).toThrow(/timezone/);
  });

  it('rejects an out-of-range coordinate', () => {
    const snap = valid();
    const bad = [...(snap.rows[0] as unknown[])];
    bad[3] = 95;
    expect(() => validateCitySnapshot({ ...snap, rows: [bad, snap.rows[1]] })).toThrow(/row 0/);
  });
});

describe('loadCitySnapshotFromDisk', () => {
  it('finds the snapshot next to the code, which is where the build copies it', () => {
    expect(CITY_SNAPSHOT_PATH).toBe(join(__dirname, 'ingest', 'data', 'normalized-cities.json'));
    expect(existsSync(CITY_SNAPSHOT_PATH)).toBe(true);
  });

  it('loads and validates the committed snapshot', () => {
    const snap = loadCitySnapshotFromDisk();
    expect(snap.count).toBeGreaterThan(30_000);
    expect(snap.rows).toHaveLength(snap.count);
    expect(snap.pin).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('says where it looked when the file is missing', () => {
    expect(() => loadCitySnapshotFromDisk(join(__dirname, 'no-such-file.json'))).toThrow(/no-such-file\.json/);
  });
});
