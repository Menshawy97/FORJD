import {
  VENDORED_COLUMNS,
  filterRawLine,
  parseGeonamesTsv,
  parseVendoredLine,
} from './geonames.adapter';

// A real cities15000 row has 19 tab-separated columns. Only the ones the adapter reads carry
// meaning here; the rest are filled the way GeoNames fills them so an off-by-one shows up.
const raw = (over: Partial<Record<string, string>> = {}): string => {
  const f = {
    id: '361058',
    name: 'Alexandria',
    ascii: 'Alexandria',
    alternates: 'Al Iskandariyah,Alexandrie,الإسكندرية',
    lat: '31.20176',
    lon: '29.91582',
    fclass: 'P',
    fcode: 'PPLA',
    cc: 'EG',
    cc2: '',
    admin1: '06',
    admin2: '',
    admin3: '',
    admin4: '',
    pop: '5263542',
    elevation: '',
    dem: '32',
    tz: 'Africa/Cairo',
    modified: '2025-05-01',
    ...over,
  };
  return [
    f.id, f.name, f.ascii, f.alternates, f.lat, f.lon, f.fclass, f.fcode, f.cc, f.cc2, f.admin1,
    f.admin2, f.admin3, f.admin4, f.pop, f.elevation, f.dem, f.tz, f.modified,
  ].join('\t');
};

describe('filterRawLine', () => {
  it('keeps exactly the nine columns FORJD reads, in a fixed order', () => {
    expect(VENDORED_COLUMNS).toEqual([
      'geonameId', 'name', 'latitude', 'longitude', 'featureCode', 'countryCode', 'admin1', 'population', 'timezone',
    ]);
    expect(filterRawLine(raw())).toBe(
      ['361058', 'Alexandria', '31.20176', '29.91582', 'PPLA', 'EG', '06', '5263542', 'Africa/Cairo'].join('\t'),
    );
  });

  it('drops the alternate names, which are most of the file', () => {
    expect(filterRawLine(raw())).not.toContain('Iskandariyah');
  });

  it('keeps an empty admin1 as an empty column so the column count stays stable', () => {
    expect(filterRawLine(raw({ admin1: '' }))?.split('\t')).toHaveLength(9);
  });

  it('rejects a line with the wrong number of columns', () => {
    expect(filterRawLine('a\tb\tc')).toBeNull();
    expect(filterRawLine('')).toBeNull();
  });
});

describe('parseVendoredLine', () => {
  const line = (over: Partial<Record<string, string>> = {}): string =>
    filterRawLine(raw(over)) as string;

  it('parses a city into typed fields', () => {
    expect(parseVendoredLine(line())).toEqual({
      geonameId: 361058,
      name: 'Alexandria',
      latitude: 31.20176,
      longitude: 29.91582,
      featureCode: 'PPLA',
      countryCode: 'EG',
      admin1: '06',
      population: 5263542,
      timezone: 'Africa/Cairo',
    });
  });

  it('reads an empty admin1 as null', () => {
    expect(parseVendoredLine(line({ admin1: '' }))?.admin1).toBeNull();
  });

  it('keeps a non-Latin name and a diacritic name intact', () => {
    expect(parseVendoredLine(line({ name: 'القاهرة' }))?.name).toBe('القاهرة');
    expect(parseVendoredLine(line({ name: 'Zürich' }))?.name).toBe('Zürich');
  });

  it.each([
    ['a non-numeric id', { id: 'abc' }],
    ['an out-of-range latitude', { lat: '91' }],
    ['an out-of-range longitude', { lon: '-181' }],
    ['a non-numeric latitude', { lat: '' }],
    ['a malformed country code', { cc: 'EGY' }],
    ['an empty name', { name: '' }],
    ['a missing timezone', { tz: '' }],
    ['a missing feature code', { fcode: '' }],
    ['a non-numeric population', { pop: 'many' }],
    ['a negative population', { pop: '-5' }],
  ])('returns null for %s', (_label, over) => {
    expect(parseVendoredLine(line(over))).toBeNull();
  });

  it('returns null for a line with the wrong column count', () => {
    expect(parseVendoredLine('1\t2\t3')).toBeNull();
  });
});

describe('parseGeonamesTsv', () => {
  it('parses every line and counts what it skipped', () => {
    const text = [
      filterRawLine(raw()),
      filterRawLine(raw({ id: '360630', name: 'Cairo', lat: '30.06263', lon: '31.24967', pop: '9606916' })),
      'garbage',
      '',
    ].join('\n');
    const { cities, skipped } = parseGeonamesTsv(text);
    expect(cities.map((c) => c.name)).toEqual(['Alexandria', 'Cairo']);
    expect(skipped).toBe(1);
  });

  it('accepts Windows line endings and a trailing newline', () => {
    const text = `${filterRawLine(raw())}\r\n${filterRawLine(raw({ id: '2', name: 'Cairo' }))}\r\n`;
    expect(parseGeonamesTsv(text).cities).toHaveLength(2);
  });

  it('is empty for empty input', () => {
    expect(parseGeonamesTsv('')).toEqual({ cities: [], skipped: 0 });
  });
});
