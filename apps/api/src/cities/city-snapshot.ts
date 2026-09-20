import { readFileSync } from 'fs';
import { join } from 'path';

import { NORMALIZED_COLUMNS, NormalizedCities } from './ingest/normalize-cities';

/**
 * Where the snapshot lives at runtime. `__dirname` is `src/cities` under ts-node and jest, and
 * `dist/cities` in the container, and the path is the same relative to both: `nest build` does not
 * copy `.json` out of `src/` on its own, so `nest-cli.json` lists this file as an asset. Without
 * that entry the file exists in development and is missing in production, and the first workout
 * upload fails there after a green CI (ADR-045).
 */
export const CITY_SNAPSHOT_PATH = join(__dirname, 'ingest', 'data', 'normalized-cities.json');

const ROW_WIDTH = NORMALIZED_COLUMNS.length;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isWellFormedRow(row: unknown, timezoneCount: number): { ok: boolean; badTimezone: boolean } {
  if (!Array.isArray(row) || row.length !== ROW_WIDTH) return { ok: false, badTimezone: false };
  const [id, name, country, lat, lon, population, timezoneIndex, slug] = row as unknown[];
  const typed =
    Number.isInteger(id) &&
    typeof name === 'string' &&
    typeof country === 'string' &&
    isFiniteNumber(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    isFiniteNumber(lon) &&
    lon >= -180 &&
    lon <= 180 &&
    isFiniteNumber(population) &&
    Number.isInteger(timezoneIndex) &&
    typeof slug === 'string';
  if (!typed) return { ok: false, badTimezone: false };
  const index = timezoneIndex as number;
  return { ok: index >= 0 && index < timezoneCount, badTimezone: index < 0 || index >= timezoneCount };
}

/**
 * Checks a parsed snapshot before anything searches it. A truncated or hand-edited file should
 * fail loudly at the first use, naming what is wrong, not return a wrong city.
 */
export function validateCitySnapshot(input: unknown): NormalizedCities {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('city snapshot is not an object');
  }
  const snapshot = input as Record<string, unknown>;

  const columns = snapshot.columns;
  if (!Array.isArray(columns) || columns.join(',') !== NORMALIZED_COLUMNS.join(',')) {
    throw new Error(`city snapshot columns are not [${NORMALIZED_COLUMNS.join(', ')}]`);
  }
  if (!Array.isArray(snapshot.rows)) throw new Error('city snapshot rows is not an array');
  if (!Array.isArray(snapshot.timezones)) throw new Error('city snapshot timezones is not an array');
  if (snapshot.count !== snapshot.rows.length) {
    throw new Error(`city snapshot count ${String(snapshot.count)} does not match ${snapshot.rows.length} rows (truncated?)`);
  }

  const timezoneCount = snapshot.timezones.length;
  snapshot.rows.forEach((row: unknown, index: number) => {
    const { ok, badTimezone } = isWellFormedRow(row, timezoneCount);
    if (badTimezone) throw new Error(`city snapshot row ${index} has a timezone index that points nowhere`);
    if (!ok) throw new Error(`city snapshot row ${index} is malformed`);
  });

  return snapshot as unknown as NormalizedCities;
}

export function loadCitySnapshotFromDisk(path: string = CITY_SNAPSHOT_PATH): NormalizedCities {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`could not read the city snapshot at ${path}: ${(error as Error).message}`);
  }
  return validateCitySnapshot(JSON.parse(text));
}
