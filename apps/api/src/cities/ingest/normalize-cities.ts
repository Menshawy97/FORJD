import { slugifyCity } from '../../users/city-slug';
import { GeonamesCity } from './geonames-source-adapter.interface';

/**
 * Columns of the committed snapshot, in order. Columnar (rows are arrays, not objects) because
 * 31,000 repeated key names would roughly double the file. `admin1` and `featureCode` are used
 * while normalizing and then dropped: nothing at runtime needs them.
 */
export const NORMALIZED_COLUMNS = [
  'geonameId',
  'name',
  'countryCode',
  'latitude',
  'longitude',
  'population',
  'timezoneIndex',
  'slug',
] as const;

/** GeoNames' code for "section of populated place": a district inside a larger place. */
export const SECTION_FEATURE_CODE = 'PPLX';

/**
 * A district is attached to the nearest larger place in its own country within this distance.
 * Farther than that and it is not part of that city, so it is dropped.
 */
export const PARENT_MAX_KM = 30;

export type NormalizedRow = [number, string, string, number, number, number, number, string];

export interface NormalizedCities {
  source: string;
  pin: string;
  /** Rows kept. The guard a loader uses to catch a truncated file. */
  count: number;
  dropped: { noSlug: number; orphanSection: number };
  columns: string[];
  /** Distinct IANA timezones, referenced from each row by index. */
  timezones: string[];
  rows: NormalizedRow[];
}

export interface SluggedCity extends GeonamesCity {
  slug: string | null;
}

const COORDINATE_DECIMALS = 4;
const round = (value: number): number => {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
};

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance. Longitude differences wrap, so the antimeridian is not a cliff. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Letters that Unicode NFKD does not decompose, so `slugifyCity` would keep them as they are and
 * the stored key would contain `đ` or `ø`. Folded here rather than in `slugifyCity` because
 * that also builds the profile's slug, and changing it would regroup existing profiles.
 */
const LATIN_FOLDS: Record<string, string> = {
  Đ: 'D', đ: 'd', Ð: 'D', ð: 'd', Ø: 'O', ø: 'o', Ł: 'L', ł: 'l', Þ: 'Th', þ: 'th',
  ß: 'ss', Æ: 'AE', æ: 'ae', Œ: 'OE', œ: 'oe', İ: 'I', ı: 'i',
};

export function foldLatin(text: string): string {
  return text.replace(/[ĐđÐðØøŁłÞþßÆæŒœİı]/g, (letter) => LATIN_FOLDS[letter] ?? letter);
}

const byId = (a: GeonamesCity, b: GeonamesCity): number => a.geonameId - b.geonameId;

/**
 * `slugifyCity(name) + '-' + countryCode + '-' + geonameId`.
 *
 * The slug is the leaderboard key stored on every workout session, so it must never change for
 * a city that still exists. A slug that depended on its neighbours (a suffix added when a
 * same-named city exists in the country) would be renamed by an unrelated re-vendor and would
 * orphan that city's history. The GeoNames id does not change, and it also separates the many
 * same-named places (Alexandria, Louisiana and Alexandria, Virginia are both `alexandria-us`).
 *
 * The profile's own `city_slug` stays the bare form: it answers a different question (display
 * grouping, not a ranking key), and ADR-045 records that the two differ.
 */
export function assignSlugs(cities: readonly GeonamesCity[]): SluggedCity[] {
  return [...cities].sort(byId).map((city) => {
    const base = slugifyCity(foldLatin(city.name));
    const slug = base === null ? null : `${base}-${city.countryCode.toLowerCase()}-${city.geonameId}`;
    return { ...city, slug };
  });
}

/**
 * The nearest place, in the same country and within {@link PARENT_MAX_KM}, that is larger than
 * the district and is not itself a district. "Larger" rather than "nearest" is the point: the
 * nearest place to Tokyo's Setagaya ward is a 19,000-person suburb, and attaching to that would
 * put 940,000 people on a board of its own instead of Tokyo's.
 */
function findParent(
  section: SluggedCity,
  places: readonly (SluggedCity & { slug: string })[],
): (SluggedCity & { slug: string }) | null {
  let best: (SluggedCity & { slug: string }) | null = null;
  let bestKm = Infinity;
  for (const place of places) {
    if (place.countryCode !== section.countryCode || place.population <= section.population) continue;
    // Cheap reject before the trigonometry: a degree of latitude is about 111 km.
    if (Math.abs(place.latitude - section.latitude) > PARENT_MAX_KM / 100) continue;
    const km = haversineKm(section.latitude, section.longitude, place.latitude, place.longitude);
    if (km > PARENT_MAX_KM) continue;
    if (km < bestKm || (km === bestKm && best !== null && place.geonameId < best.geonameId)) {
      best = place;
      bestKm = km;
    }
  }
  return best;
}

/**
 * The pure core of `cities:normalize`. Sorted ascending by latitude (then longitude, then id) so
 * the resolver can binary-search a latitude band, and so the output is byte-identical whatever
 * order the input arrived in, which is what lets CI diff it.
 *
 * Districts (`PPLX`) stay in the snapshot as locating points, but carry their parent's name,
 * slug and timezone. A position in Setagaya then resolves to the row for Setagaya and comes back
 * as Tokyo, with no special case in the resolver. A district with no parent is dropped.
 */
export function normalizeCities(
  cities: readonly GeonamesCity[],
  meta: { source: string; pin: string },
): NormalizedCities {
  const slugged = assignSlugs(cities);
  const isSection = (city: SluggedCity): boolean => city.featureCode === SECTION_FEATURE_CODE;

  const places = slugged.filter((city): city is SluggedCity & { slug: string } => !isSection(city) && city.slug !== null);
  const noSlug = slugged.filter((city) => !isSection(city) && city.slug === null).length;

  const resolved: (SluggedCity & { slug: string })[] = [...places];
  let orphanSection = 0;
  for (const section of slugged.filter(isSection)) {
    const parent = findParent(section, places);
    if (parent === null) {
      orphanSection += 1;
      continue;
    }
    resolved.push({ ...section, name: parent.name, slug: parent.slug, timezone: parent.timezone });
  }

  const sorted = resolved.sort(
    (a, b) => a.latitude - b.latitude || a.longitude - b.longitude || a.geonameId - b.geonameId,
  );

  const timezones = [...new Set(sorted.map((city) => city.timezone))].sort();
  const timezoneIndex = new Map(timezones.map((tz, index) => [tz, index]));

  const rows: NormalizedRow[] = sorted.map((city) => [
    city.geonameId,
    city.name,
    city.countryCode,
    round(city.latitude),
    round(city.longitude),
    city.population,
    timezoneIndex.get(city.timezone) as number,
    city.slug,
  ]);

  return {
    source: meta.source,
    pin: meta.pin,
    count: rows.length,
    dropped: { noSlug, orphanSection },
    columns: [...NORMALIZED_COLUMNS],
    timezones,
    rows,
  };
}
