import { GeonamesCity } from './geonames-source-adapter.interface';
import {
  NORMALIZED_COLUMNS,
  PARENT_MAX_KM,
  assignSlugs,
  foldLatin,
  haversineKm,
  normalizeCities,
} from './normalize-cities';

const city = (over: Partial<GeonamesCity> = {}): GeonamesCity => ({
  geonameId: 361058,
  name: 'Alexandria',
  latitude: 31.20176,
  longitude: 29.91582,
  featureCode: 'PPLA',
  countryCode: 'EG',
  admin1: '06',
  population: 5263542,
  timezone: 'Africa/Cairo',
  ...over,
});

const meta = { source: 's', pin: 'p' };
const col = (name: (typeof NORMALIZED_COLUMNS)[number]): number => NORMALIZED_COLUMNS.indexOf(name);

describe('foldLatin', () => {
  it('folds the Latin letters NFKD leaves alone', () => {
    expect(foldLatin('Đà Nẵng')).toBe('Dà Nẵng');
    expect(foldLatin('Łódź')).toBe('Lódź');
    expect(foldLatin('Tromsø')).toBe('Tromso');
    expect(foldLatin('Reykjavík Þ ð')).toBe('Reykjavík Th d');
    expect(foldLatin('Straße')).toBe('Strasse');
    expect(foldLatin('İstanbul ı')).toBe('Istanbul i');
    expect(foldLatin('Æ æ Œ œ')).toBe('AE ae OE oe');
  });

  it('leaves other scripts and plain text untouched', () => {
    expect(foldLatin('القاهرة')).toBe('القاهرة');
    expect(foldLatin('北京')).toBe('北京');
    expect(foldLatin('Alexandria')).toBe('Alexandria');
  });
});

describe('assignSlugs', () => {
  it('is the city slug, the lower-case country code and the GeoNames id', () => {
    const [only] = assignSlugs([city()]);
    expect(only?.slug).toBe('alexandria-eg-361058');
  });

  it('does not depend on any other city, so a re-vendor cannot rename it', () => {
    const alone = assignSlugs([city()])[0]?.slug;
    const withNamesake = assignSlugs([
      city(),
      city({ geonameId: 999, admin1: '06' }),
      city({ geonameId: 1000, countryCode: 'US' }),
    ]).find((c) => c.geonameId === 361058)?.slug;
    expect(withNamesake).toBe(alone);
  });

  it('gives same-named cities in one country different slugs', () => {
    const slugs = assignSlugs([
      city({ geonameId: 4314550, countryCode: 'US', admin1: 'LA' }),
      city({ geonameId: 4744091, countryCode: 'US', admin1: 'VA' }),
    ]).map((c) => c.slug);
    expect(slugs).toEqual(['alexandria-us-4314550', 'alexandria-us-4744091']);
  });

  it('strips diacritics through the same slugifyCity the profile uses', () => {
    expect(assignSlugs([city({ geonameId: 7, name: 'Zürich', countryCode: 'CH' })])[0]?.slug).toBe('zurich-ch-7');
  });

  it('folds letters NFKD does not decompose, so a stored key is plain and stable', () => {
    expect(assignSlugs([city({ geonameId: 8, name: 'Đà Nẵng', countryCode: 'VN' })])[0]?.slug).toBe('da-nang-vn-8');
    expect(assignSlugs([city({ geonameId: 9, name: 'Łódź', countryCode: 'PL' })])[0]?.slug).toBe('lodz-pl-9');
  });

  it('keeps a non-Latin name as it is rather than dropping the city', () => {
    expect(assignSlugs([city({ geonameId: 6, name: 'القاهرة' })])[0]?.slug).toBe('القاهرة-eg-6');
  });

  it('gives a name that slugifies to nothing a null slug so it can be dropped', () => {
    expect(assignSlugs([city({ name: '---' })])[0]?.slug).toBeNull();
  });

  it('returns cities in id order, whatever order they arrived in', () => {
    const ids = assignSlugs([city({ geonameId: 5 }), city({ geonameId: 2 }), city({ geonameId: 9 })]).map(
      (c) => c.geonameId,
    );
    expect(ids).toEqual([2, 5, 9]);
  });
});

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(31.2, 29.9, 31.2, 29.9)).toBe(0);
  });

  it('is about 179 km from Cairo to Alexandria', () => {
    expect(haversineKm(30.0626, 31.2497, 31.2018, 29.9158)).toBeGreaterThan(170);
    expect(haversineKm(30.0626, 31.2497, 31.2018, 29.9158)).toBeLessThan(190);
  });

  it('wraps the antimeridian', () => {
    expect(haversineKm(0, 179.9, 0, -179.9)).toBeLessThan(30);
  });
});

describe('normalizeCities', () => {
  it('writes a columnar snapshot whose column list names every field in order', () => {
    expect(NORMALIZED_COLUMNS).toEqual([
      'geonameId', 'name', 'countryCode', 'latitude', 'longitude', 'population', 'timezoneIndex', 'slug',
    ]);
  });

  it('describes itself so a truncated file can be caught', () => {
    const out = normalizeCities([city()], { source: 'geonames-cities15000', pin: '2026-09-20' });
    expect(out.source).toBe('geonames-cities15000');
    expect(out.pin).toBe('2026-09-20');
    expect(out.count).toBe(1);
    expect(out.rows).toHaveLength(1);
    expect(out.columns).toEqual([...NORMALIZED_COLUMNS]);
  });

  it('stores each timezone once and points to it by index', () => {
    const out = normalizeCities(
      [
        city({ geonameId: 2, name: 'Cairo', timezone: 'Africa/Cairo' }),
        city({ geonameId: 3, name: 'Rome', countryCode: 'IT', latitude: 41.9, longitude: 12.5, timezone: 'Europe/Rome' }),
        city({ geonameId: 4, name: 'Giza', latitude: 30.0, longitude: 31.2, timezone: 'Africa/Cairo' }),
      ],
      meta,
    );
    expect(out.timezones).toEqual(['Africa/Cairo', 'Europe/Rome']);
    const byId = new Map(out.rows.map((r) => [r[col('geonameId')], r[col('timezoneIndex')]]));
    expect(byId.get(2)).toBe(0);
    expect(byId.get(3)).toBe(1);
    expect(byId.get(4)).toBe(0);
  });

  it('rounds coordinates to four decimal places', () => {
    const out = normalizeCities([city({ latitude: 31.201765432, longitude: 29.915824444 })], meta);
    expect(out.rows[0]?.[col('latitude')]).toBe(31.2018);
    expect(out.rows[0]?.[col('longitude')]).toBe(29.9158);
  });

  it('sorts ascending by latitude, then longitude, then id, which the resolver relies on', () => {
    const out = normalizeCities(
      [
        city({ geonameId: 3, name: 'C', latitude: 40, longitude: 10 }),
        city({ geonameId: 1, name: 'A', latitude: -33, longitude: 151 }),
        city({ geonameId: 2, name: 'B', latitude: 40, longitude: -5 }),
      ],
      meta,
    );
    expect(out.rows.map((r) => r[col('latitude')])).toEqual([-33, 40, 40]);
    expect(out.rows.map((r) => r[col('geonameId')])).toEqual([1, 2, 3]);
  });

  it('does not depend on input order', () => {
    const cities = [city({ geonameId: 5, latitude: 1 }), city({ geonameId: 6, name: 'X', latitude: 2 })];
    expect(normalizeCities([...cities].reverse(), meta)).toEqual(normalizeCities(cities, meta));
  });

  it('drops a city with no usable slug and counts why', () => {
    const out = normalizeCities([city(), city({ geonameId: 9, name: '---' })], meta);
    expect(out.count).toBe(1);
    expect(out.dropped).toEqual({ noSlug: 1, orphanSection: 0 });
  });

  it('carries no admin1, only what a nearest-city lookup needs', () => {
    expect(JSON.stringify(normalizeCities([city()], meta))).not.toContain('"06"');
  });

  it('does not mutate its input', () => {
    const input = [city(), city({ geonameId: 2, name: 'Cairo' })];
    const before = JSON.stringify(input);
    normalizeCities(input, meta);
    expect(JSON.stringify(input)).toBe(before);
  });

  describe('district sections (PPLX)', () => {
    const tokyo = city({
      geonameId: 1850147, name: 'Tokyo', countryCode: 'JP', latitude: 35.6895, longitude: 139.69171,
      featureCode: 'PPLC', population: 8336599, timezone: 'Asia/Tokyo',
    });
    const setagaya = city({
      geonameId: 1857575, name: 'Setagaya', countryCode: 'JP', latitude: 35.6464, longitude: 139.6533,
      featureCode: 'PPLX', population: 940000, timezone: 'Asia/Tokyo',
    });

    it('keeps a district as a locating point that carries its parent city name and slug', () => {
      const out = normalizeCities([tokyo, setagaya], meta);
      expect(out.count).toBe(2);
      const row = out.rows.find((r) => r[col('geonameId')] === 1857575);
      expect(row?.[col('name')]).toBe('Tokyo');
      expect(row?.[col('slug')]).toBe('tokyo-jp-1850147');
      expect(row?.[col('latitude')]).toBe(35.6464);
    });

    it('takes the parent as the nearest larger place, not the nearest place', () => {
      const denenchofu = city({
        geonameId: 1855429, name: "Den'enchōfu", countryCode: 'JP', latitude: 35.6, longitude: 139.667,
        featureCode: 'PPL', population: 19000, timezone: 'Asia/Tokyo',
      });
      const out = normalizeCities([tokyo, setagaya, denenchofu], meta);
      const row = out.rows.find((r) => r[col('geonameId')] === 1857575);
      expect(row?.[col('slug')]).toBe('tokyo-jp-1850147');
    });

    it('never picks another section as a parent', () => {
      const ward = city({
        geonameId: 5, name: 'Big Ward', countryCode: 'JP', latitude: 35.65, longitude: 139.65,
        featureCode: 'PPLX', population: 2_000_000, timezone: 'Asia/Tokyo',
      });
      const out = normalizeCities([tokyo, setagaya, ward], meta);
      expect(out.rows.find((r) => r[col('geonameId')] === 1857575)?.[col('name')]).toBe('Tokyo');
    });

    it('does not cross a border: a parent must be in the same country', () => {
      const other = city({
        geonameId: 77, name: 'Tokyo', countryCode: 'KR', latitude: 35.6895, longitude: 139.69171,
        featureCode: 'PPLC', population: 9_000_000, timezone: 'Asia/Seoul',
      });
      const out = normalizeCities([other, setagaya], meta);
      expect(out.rows.map((r) => r[col('geonameId')])).toEqual([77]);
      expect(out.dropped.orphanSection).toBe(1);
    });

    it('drops a district with no larger place within the parent radius', () => {
      const farAway = city({
        geonameId: 88, name: 'Far', countryCode: 'JP', latitude: 43.0, longitude: 141.35,
        featureCode: 'PPLA', population: 1_900_000, timezone: 'Asia/Tokyo',
      });
      const out = normalizeCities([farAway, setagaya], meta);
      expect(PARENT_MAX_KM).toBeLessThan(100);
      expect(out.rows.map((r) => r[col('geonameId')])).toEqual([88]);
      expect(out.dropped.orphanSection).toBe(1);
    });

    it('drops a district that is larger than every place near it', () => {
      const village = city({
        geonameId: 99, name: 'Village', countryCode: 'JP', latitude: 35.65, longitude: 139.65,
        featureCode: 'PPL', population: 20000, timezone: 'Asia/Tokyo',
      });
      const out = normalizeCities([village, setagaya], meta);
      expect(out.dropped.orphanSection).toBe(1);
    });

    it('does not let a district affect its parent or the slugs of other cities', () => {
      const alone = normalizeCities([tokyo], meta).rows[0];
      const withDistrict = normalizeCities([tokyo, setagaya], meta).rows.find(
        (r) => r[col('geonameId')] === 1850147,
      );
      expect(withDistrict).toEqual(alone);
    });

    it('is order independent', () => {
      expect(normalizeCities([setagaya, tokyo], meta)).toEqual(normalizeCities([tokyo, setagaya], meta));
    });
  });
});
