import { readFileSync } from 'fs';
import { join } from 'path';

import { NORMALIZED_COLUMNS, NormalizedCities, NormalizedRow } from './ingest/normalize-cities';
import { buildCityIndex, nearestBruteForce } from './city-index';

const row = (
  geonameId: number,
  name: string,
  lat: number,
  lon: number,
  over: { population?: number; countryCode?: string; slug?: string; tz?: number } = {},
): NormalizedRow => [
  geonameId,
  name,
  over.countryCode ?? 'EG',
  lat,
  lon,
  over.population ?? 100_000,
  over.tz ?? 0,
  over.slug ?? `${name.toLowerCase()}-${geonameId}`,
];

const snapshot = (rows: NormalizedRow[], timezones = ['Africa/Cairo']): NormalizedCities => ({
  source: 'test',
  pin: 'test',
  count: rows.length,
  dropped: { noSlug: 0, orphanSection: 0 },
  columns: [...NORMALIZED_COLUMNS],
  timezones,
  rows: [...rows].sort((a, b) => a[3] - b[3] || a[4] - b[4] || a[0] - b[0]),
});

const MAX_KM = 120;

describe('buildCityIndex', () => {
  it('reports how many places it holds', () => {
    expect(buildCityIndex(snapshot([row(1, 'A', 10, 10), row(2, 'B', 20, 20)])).size).toBe(2);
  });

  it('refuses rows that are not sorted by latitude, which the search depends on', () => {
    const unsorted: NormalizedCities = { ...snapshot([row(1, 'A', 10, 10), row(2, 'B', 20, 20)]) };
    unsorted.rows = [...unsorted.rows].reverse();
    expect(() => buildCityIndex(unsorted)).toThrow(/sorted/);
  });

  it('builds an empty index that finds nothing', () => {
    expect(buildCityIndex(snapshot([])).nearest(0, 0, MAX_KM)).toBeNull();
  });
});

describe('nearest', () => {
  const cairo = row(360630, 'Cairo', 30.06263, 31.24967, { population: 9_606_916, slug: 'cairo-eg-360630' });
  const alex = row(361058, 'Alexandria', 31.20176, 29.91582, { population: 5_263_542, slug: 'alexandria-eg-361058' });
  const index = buildCityIndex(snapshot([cairo, alex]));

  it('finds the city a point sits in', () => {
    const match = index.nearest(31.2, 29.92, MAX_KM);
    expect(match?.name).toBe('Alexandria');
    expect(match?.slug).toBe('alexandria-eg-361058');
    expect(match?.geonameId).toBe(361058);
    expect(match?.countryCode).toBe('EG');
    expect(match?.distanceKm).toBeLessThan(2);
  });

  it('still finds it a few kilometres out', () => {
    expect(index.nearest(31.25, 29.99, MAX_KM)?.name).toBe('Alexandria');
  });

  it('returns the timezone name, not its index', () => {
    expect(index.nearest(31.2, 29.92, MAX_KM)?.timezone).toBe('Africa/Cairo');
  });

  it('picks the nearer of two cities', () => {
    expect(index.nearest(30.1, 31.3, MAX_KM)?.name).toBe('Cairo');
  });

  it('returns null beyond the distance cap', () => {
    expect(index.nearest(0, -30, MAX_KM)).toBeNull();
    expect(index.nearest(28.0, 30.0, 50)).toBeNull();
  });

  it('includes a city exactly inside the cap and excludes one just outside', () => {
    const single = buildCityIndex(snapshot([row(1, 'X', 0, 0)]));
    // One degree of longitude on the equator is about 111.19 km.
    expect(single.nearest(0, 1, 112)?.name).toBe('X');
    expect(single.nearest(0, 1, 111)).toBeNull();
  });

  it('breaks an exact distance tie towards the more populous city, then the lower id', () => {
    const tie = buildCityIndex(
      snapshot([
        row(10, 'Small', 0, 1, { population: 100 }),
        row(20, 'Big', 0, -1, { population: 900 }),
      ]),
    );
    expect(tie.nearest(0, 0, MAX_KM)?.name).toBe('Big');

    const sameSize = buildCityIndex(
      snapshot([row(30, 'B', 0, 1, { population: 500 }), row(20, 'A', 0, -1, { population: 500 })]),
    );
    expect(sameSize.nearest(0, 0, MAX_KM)?.name).toBe('A');
  });

  it('finds a city across the antimeridian in both directions', () => {
    const fiji = buildCityIndex(snapshot([row(1, 'East', -17.0, -179.9), row(2, 'West', -17.0, 179.9)]));
    expect(fiji.nearest(-17.0, 179.95, 40)?.name).toBe('West');
    const onlyEast = buildCityIndex(snapshot([row(1, 'East', -17.0, -179.9)]));
    expect(onlyEast.nearest(-17.0, 179.9, MAX_KM)?.name).toBe('East');
    const onlyWest = buildCityIndex(snapshot([row(2, 'West', -17.0, 179.9)]));
    expect(onlyWest.nearest(-17.0, -179.9, MAX_KM)?.name).toBe('West');
  });

  it('does not throw at the poles, and finds a city near one', () => {
    const arctic = buildCityIndex(snapshot([row(1, 'Longyearbyen', 78.22, 15.65, { countryCode: 'NO' })]));
    expect(arctic.nearest(89, 0, MAX_KM)).toBeNull();
    expect(arctic.nearest(90, 0, MAX_KM)).toBeNull();
    expect(arctic.nearest(-90, 0, MAX_KM)).toBeNull();
    expect(arctic.nearest(78.2, 15.6, MAX_KM)?.name).toBe('Longyearbyen');
  });

  it('finds a city within reach of the pole across every longitude', () => {
    const pole = buildCityIndex(snapshot([row(1, 'Alert', 82.5, -62.3)]));
    expect(pole.nearest(89.9, 100, 900)?.name).toBe('Alert');
  });

  it.each([
    ['NaN latitude', Number.NaN, 0],
    ['NaN longitude', 0, Number.NaN],
    ['infinite latitude', Number.POSITIVE_INFINITY, 0],
    ['latitude above 90', 91, 0],
    ['latitude below -90', -91, 0],
    ['longitude above 180', 0, 181],
    ['longitude below -180', 0, -181],
  ])('returns null for %s', (_label, lat, lon) => {
    expect(index.nearest(lat, lon, MAX_KM)).toBeNull();
  });

  it('returns null for a cap that is not positive', () => {
    expect(index.nearest(31.2, 29.92, 0)).toBeNull();
    expect(index.nearest(31.2, 29.92, -5)).toBeNull();
  });
});

describe('nearestBruteForce', () => {
  it('returns null for coordinates or a cap that are not usable, like the indexed search', () => {
    const snap = snapshot([row(1, 'X', 0, 0)]);
    expect(nearestBruteForce(snap, Number.NaN, 0, 120)).toBeNull();
    expect(nearestBruteForce(snap, 0, 0, 0)).toBeNull();
    expect(nearestBruteForce(snap, 0, 0, 120)?.name).toBe('X');
  });
});

describe('bySlug', () => {
  const index = buildCityIndex(
    snapshot([
      row(1, 'Alexandria', 31.2, 29.9, { slug: 'alexandria-eg-1', tz: 0 }),
      // A district row carries its parent's slug, so one slug can appear on several rows.
      row(2, 'Alexandria', 31.0, 29.8, { slug: 'alexandria-eg-1', tz: 0 }),
      row(3, 'Rome', 41.9, 12.5, { slug: 'rome-it-3', countryCode: 'IT', tz: 1 }),
    ], ['Africa/Cairo', 'Europe/Rome']),
  );

  it('finds a city by its slug, with the timezone as a name', () => {
    expect(index.bySlug('alexandria-eg-1')).toEqual({
      name: 'Alexandria',
      slug: 'alexandria-eg-1',
      countryCode: 'EG',
      timezone: 'Africa/Cairo',
    });
    expect(index.bySlug('rome-it-3')?.timezone).toBe('Europe/Rome');
  });

  it('is null for a slug that is not in the list, for example one from an older version of it', () => {
    expect(index.bySlug('atlantis-xx-9')).toBeNull();
    expect(index.bySlug('')).toBeNull();
  });

  it('answers from the first row when several rows share the slug', () => {
    expect(index.bySlug('alexandria-eg-1')?.name).toBe('Alexandria');
  });
});

describe('nearest agrees with a brute-force scan', () => {
  // A small deterministic generator, so the property test is repeatable.
  const seeded = (seed: number): (() => number) => {
    let state = seed;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return state / 4_294_967_296;
    };
  };

  it('matches on 500 random points over 300 random cities, including near the antimeridian and poles', () => {
    const random = seeded(42);
    const rows = Array.from({ length: 300 }, (_, i) =>
      row(i + 1, `C${i}`, Math.round((random() * 180 - 90) * 1e4) / 1e4, Math.round((random() * 360 - 180) * 1e4) / 1e4, {
        population: Math.floor(random() * 1_000_000),
      }),
    );
    const snap = snapshot(rows);
    const index = buildCityIndex(snap);
    const maxKm = 1500;
    for (let i = 0; i < 500; i += 1) {
      const lat = random() * 180 - 90;
      const lon = i % 5 === 0 ? (random() < 0.5 ? 179.9 : -179.9) : random() * 360 - 180;
      const fast = index.nearest(lat, lon, maxKm);
      const slow = nearestBruteForce(snap, lat, lon, maxKm);
      expect(fast?.geonameId ?? null).toBe(slow?.geonameId ?? null);
    }
  });
});

describe('against the committed snapshot', () => {
  const real = JSON.parse(
    readFileSync(join(__dirname, 'ingest', 'data', 'normalized-cities.json'), 'utf8'),
  ) as NormalizedCities;
  const index = buildCityIndex(real);

  it.each([
    ['Alexandria, Egypt', 31.2001, 29.9187, 'alexandria-eg-361058'],
    ['Cairo, Egypt', 30.0444, 31.2357, 'cairo-eg-360630'],
    ['Tokyo Station', 35.6812, 139.7671, 'tokyo-jp-1850147'],
    ['a Setagaya street, which is a district of Tokyo', 35.6464, 139.6533, 'tokyo-jp-1850147'],
    ['Nasr City, a district of Cairo', 30.0561, 31.3301, 'cairo-eg-360630'],
    ['London', 51.5074, -0.1278, 'london-gb-2643743'],
  ])('resolves %s', (_label, lat, lon, slug) => {
    expect(index.nearest(lat, lon, MAX_KM)?.slug).toBe(slug);
  });

  it('never files Alexandria, Virginia under Alexandria, Egypt, and puts it in its metro', () => {
    const slug = index.nearest(38.8048, -77.0469, MAX_KM)?.slug;
    expect(slug).not.toMatch(/-eg-/);
    expect(slug).toBe('washington-us-4140963');
  });

  it('keeps comparable neighbours apart: Oakland is not San Francisco, Giza is not Cairo', () => {
    expect(index.nearest(37.8044, -122.2712, MAX_KM)?.slug).toBe('oakland-us-5378538');
    expect(index.nearest(30.0131, 31.2089, MAX_KM)?.slug).toBe('giza-eg-360995');
  });

  it('puts Manhattan and Jersey City in New York rather than on boards of their own', () => {
    expect(index.nearest(40.758, -73.9855, MAX_KM)?.slug).toBe('new-york-city-us-5128581');
    expect(index.nearest(40.7178, -74.0431, MAX_KM)?.slug).toBe('new-york-city-us-5128581');
  });

  it('finds nothing in the middle of the Atlantic', () => {
    expect(index.nearest(0, -30, MAX_KM)).toBeNull();
  });

  it('agrees with a brute-force scan at real cities', () => {
    for (const [lat, lon] of [[31.2, 29.9], [35.68, 139.76], [-33.87, 151.21], [64.15, -21.94], [-17.7, 178.0]] as const) {
      expect(index.nearest(lat, lon, MAX_KM)?.geonameId ?? null).toBe(
        nearestBruteForce(real, lat, lon, MAX_KM)?.geonameId ?? null,
      );
    }
  });
});
