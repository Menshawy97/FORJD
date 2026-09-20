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

/**
 * Metro dominance: a place attaches to the largest place within {@link DOMINANCE_MAX_KM} that is
 * at least {@link DOMINANCE_RATIO} times its size, in the same country. GeoNames lists the wards
 * and suburbs of a big city as ordinary places (Tokyo's Chuo and Minato, Manhattan, Jersey City),
 * so without this a Tokyo Station position resolves to "Chuo" and one metro area is split over
 * dozens of boards. Comparable neighbours stay apart: Oakland and San Francisco are 2x, Giza and
 * Cairo 2.2x, Yokohama and Tokyo 2.6x. Both numbers are product judgements, not measurements
 * (ADR-045), and a wrong one is corrected by re-running the normalizer.
 */
export const DOMINANCE_RATIO = 4;
export const DOMINANCE_MAX_KM = 25;

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

type Place = SluggedCity & { slug: string };

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

/** Places sorted by latitude, searchable by a latitude window so no lookup scans all 31,000. */
class LatitudeIndex {
  private readonly sorted: Place[];

  constructor(places: readonly Place[]) {
    this.sorted = [...places].sort((a, b) => a.latitude - b.latitude || a.geonameId - b.geonameId);
  }

  /** Places within `km` of latitude, plus a little slack: a degree of latitude is about 111 km. */
  near(latitude: number, km: number): Place[] {
    const band = km / 110;
    let low = 0;
    let high = this.sorted.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if ((this.sorted[mid] as Place).latitude < latitude - band) low = mid + 1;
      else high = mid;
    }
    const found: Place[] = [];
    for (let i = low; i < this.sorted.length && (this.sorted[i] as Place).latitude <= latitude + band; i += 1) {
      found.push(this.sorted[i] as Place);
    }
    return found;
  }
}

/** The largest place within reach that is at least {@link DOMINANCE_RATIO} times `place`. */
function findDominantParent(place: Place, index: LatitudeIndex): Place | null {
  let best: Place | null = null;
  for (const other of index.near(place.latitude, DOMINANCE_MAX_KM)) {
    if (other.geonameId === place.geonameId || other.countryCode !== place.countryCode) continue;
    if (other.population < DOMINANCE_RATIO * place.population) continue;
    if (haversineKm(place.latitude, place.longitude, other.latitude, other.longitude) > DOMINANCE_MAX_KM) continue;
    if (best === null || other.population > best.population || (other.population === best.population && other.geonameId < best.geonameId)) {
      best = other;
    }
  }
  return best;
}

/**
 * The parent of a district: the largest place within {@link PARENT_MAX_KM} that is at least four
 * times its size if there is one (Delhi, not the satellite Najafgarh), otherwise the nearest
 * larger place. Always in the same country, and never itself a district. Sections are held to a
 * weaker test than places (larger, not four times larger) because a section is by definition part
 * of some place: Kowloon is only 3.3x Hong Kong's remainder and still belongs to it.
 */
function findSectionParent(section: SluggedCity, index: LatitudeIndex): Place | null {
  let nearest: Place | null = null;
  let nearestKm = Infinity;
  let dominant: Place | null = null;
  for (const place of index.near(section.latitude, PARENT_MAX_KM)) {
    if (place.countryCode !== section.countryCode || place.population <= section.population) continue;
    const km = haversineKm(section.latitude, section.longitude, place.latitude, place.longitude);
    if (km > PARENT_MAX_KM) continue;
    if (km < nearestKm || (km === nearestKm && nearest !== null && place.geonameId < nearest.geonameId)) {
      nearest = place;
      nearestKm = km;
    }
    // A place four times the district's size is a metro, not a neighbour: Delhi, not Najafgarh.
    if (
      place.population >= DOMINANCE_RATIO * section.population &&
      (dominant === null ||
        place.population > dominant.population ||
        (place.population === dominant.population && place.geonameId < dominant.geonameId))
    ) {
      dominant = place;
    }
  }
  return dominant ?? nearest;
}

/**
 * The pure core of `cities:normalize`. Sorted ascending by latitude (then longitude, then id) so
 * the resolver can binary-search a latitude band, and so the output is byte-identical whatever
 * order the input arrived in, which is what lets CI diff it.
 *
 * Every place stays in the snapshot as a locating point, but the name, slug and timezone it
 * carries are those of the city it belongs to: its own if it is a root, otherwise the root of its
 * dominance chain (a suburb of a ward of Tokyo comes back as Tokyo). A resolver that simply finds
 * the nearest row therefore needs no special cases. A district with no parent is dropped.
 */
export function normalizeCities(
  cities: readonly GeonamesCity[],
  meta: { source: string; pin: string },
): NormalizedCities {
  const slugged = assignSlugs(cities);
  const isSection = (city: SluggedCity): boolean => city.featureCode === SECTION_FEATURE_CODE;

  const places = slugged.filter((city): city is Place => !isSection(city) && city.slug !== null);
  const noSlug = slugged.filter((city) => !isSection(city) && city.slug === null).length;
  const index = new LatitudeIndex(places);

  // Each place's dominance parent. A parent is strictly larger (at least 4x), so no cycle exists.
  const parentOf = new Map<number, Place>();
  for (const place of places) {
    const parent = findDominantParent(place, index);
    if (parent !== null) parentOf.set(place.geonameId, parent);
  }
  const rootOf = (place: Place): Place => {
    let current = place;
    for (let next = parentOf.get(current.geonameId); next !== undefined; next = parentOf.get(current.geonameId)) {
      current = next;
    }
    return current;
  };

  const resolved: Place[] = places.map((place) => {
    const root = rootOf(place);
    return { ...place, name: root.name, slug: root.slug, timezone: root.timezone };
  });

  let orphanSection = 0;
  for (const section of slugged.filter(isSection)) {
    const parent = findSectionParent(section, index);
    if (parent === null) {
      orphanSection += 1;
      continue;
    }
    const root = rootOf(parent);
    resolved.push({ ...section, slug: root.slug, name: root.name, timezone: root.timezone });
  }

  const sorted = resolved.sort(
    (a, b) => a.latitude - b.latitude || a.longitude - b.longitude || a.geonameId - b.geonameId,
  );

  const timezones = [...new Set(sorted.map((city) => city.timezone))].sort();
  const timezoneIndex = new Map(timezones.map((tz, position) => [tz, position]));

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
