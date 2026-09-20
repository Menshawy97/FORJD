import { GeonamesCity } from './geonames-source-adapter.interface';

/**
 * The GeoNames `cities15000` export has 19 tab-separated columns (readme.txt at
 * download.geonames.org/export/dump). FORJD reads nine of them, and this file and
 * `fetch-geonames.ts` are the only places that know the layout (ADR-045).
 */
const RAW_COLUMN_COUNT = 19;
const RAW = {
  geonameId: 0,
  name: 1,
  latitude: 4,
  longitude: 5,
  featureCode: 7,
  countryCode: 8,
  admin1: 10,
  population: 14,
  timezone: 17,
} as const;

/** The columns of the vendored extract, in order. `alternatenames` is most of the raw file and is dropped. */
export const VENDORED_COLUMNS = [
  'geonameId',
  'name',
  'latitude',
  'longitude',
  'featureCode',
  'countryCode',
  'admin1',
  'population',
  'timezone',
] as const;

const COLUMN_COUNT = VENDORED_COLUMNS.length;

/** A raw 19-column line to the vendored 9-column line, or null if it is not a well-formed row. */
export function filterRawLine(rawLine: string): string | null {
  const fields = rawLine.split('\t');
  if (fields.length !== RAW_COLUMN_COUNT) return null;
  return VENDORED_COLUMNS.map((column) => fields[RAW[column]] ?? '').join('\t');
}

const parseNumber = (text: string): number | null => {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/** One vendored line to a typed city, or null if any field is missing or out of range. */
export function parseVendoredLine(line: string): GeonamesCity | null {
  const fields = line.split('\t');
  if (fields.length !== COLUMN_COUNT) return null;
  const [idText, name, latText, lonText, featureCode, countryCode, admin1, populationText, timezone] = fields as [
    string, string, string, string, string, string, string, string, string,
  ];

  const geonameId = parseNumber(idText);
  const latitude = parseNumber(latText);
  const longitude = parseNumber(lonText);
  const population = parseNumber(populationText);

  if (geonameId === null || !Number.isInteger(geonameId) || geonameId <= 0) return null;
  if (latitude === null || latitude < -90 || latitude > 90) return null;
  if (longitude === null || longitude < -180 || longitude > 180) return null;
  if (population === null || population < 0) return null;
  if (name.trim() === '' || timezone.trim() === '' || featureCode.trim() === '') return null;
  if (!/^[A-Z]{2}$/.test(countryCode)) return null;

  return {
    geonameId,
    name,
    latitude,
    longitude,
    featureCode,
    countryCode,
    admin1: admin1 === '' ? null : admin1,
    population,
    timezone,
  };
}

/** The whole vendored file. Blank lines are ignored; malformed lines are counted, not thrown. */
export function parseGeonamesTsv(text: string): { cities: GeonamesCity[]; skipped: number } {
  const cities: GeonamesCity[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line === '') continue;
    const parsed = parseVendoredLine(line);
    if (parsed === null) skipped += 1;
    else cities.push(parsed);
  }
  return { cities, skipped };
}
