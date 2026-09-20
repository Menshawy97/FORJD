import { NormalizedCities, haversineKm } from './ingest/normalize-cities';

/** What a lookup returns: the place a position resolved to, and how far away it was. */
export interface CityMatch {
  geonameId: number;
  name: string;
  countryCode: string;
  slug: string;
  timezone: string;
  distanceKm: number;
}

export interface CityIndex {
  readonly size: number;
  /** The nearest place within `maxKm`, or null. Never throws on bad coordinates. */
  nearest(latitude: number, longitude: number, maxKm: number): CityMatch | null;
}

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

const ROW = { geonameId: 0, name: 1, countryCode: 2, latitude: 3, longitude: 4, population: 5, timezoneIndex: 6, slug: 7 } as const;

const isValidQuery = (latitude: number, longitude: number, maxKm: number): boolean =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180 &&
  Number.isFinite(maxKm) &&
  maxKm > 0;

/** True when candidate `a` should replace the current best `b`: nearer, then more populous, then lower id. */
function isBetter(
  distanceKm: number,
  population: number,
  geonameId: number,
  best: { distanceKm: number; population: number; geonameId: number },
): boolean {
  if (distanceKm !== best.distanceKm) return distanceKm < best.distanceKm;
  if (population !== best.population) return population > best.population;
  return geonameId < best.geonameId;
}

const toMatch = (snapshot: NormalizedCities, row: NormalizedCities['rows'][number], distanceKm: number): CityMatch => ({
  geonameId: row[ROW.geonameId],
  name: row[ROW.name],
  countryCode: row[ROW.countryCode],
  slug: row[ROW.slug],
  timezone: snapshot.timezones[row[ROW.timezoneIndex]] as string,
  distanceKm,
});

/**
 * The obviously-correct O(n) scan. Not used at runtime: it is the reference the indexed search is
 * tested against, so an optimisation cannot quietly change an answer.
 */
export function nearestBruteForce(
  snapshot: NormalizedCities,
  latitude: number,
  longitude: number,
  maxKm: number,
): CityMatch | null {
  if (!isValidQuery(latitude, longitude, maxKm)) return null;
  let best: { row: NormalizedCities['rows'][number]; distanceKm: number; population: number; geonameId: number } | null = null;
  for (const row of snapshot.rows) {
    const distanceKm = haversineKm(latitude, longitude, row[ROW.latitude], row[ROW.longitude]);
    if (distanceKm > maxKm) continue;
    if (best === null || isBetter(distanceKm, row[ROW.population], row[ROW.geonameId], best)) {
      best = { row, distanceKm, population: row[ROW.population], geonameId: row[ROW.geonameId] };
    }
  }
  return best === null ? null : toMatch(snapshot, best.row, best.distanceKm);
}

/** First index in the ascending `values` that is >= `target`. */
function lowerBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((values[mid] as number) < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * A nearest-place index over a snapshot sorted by latitude. In memory, not Postgres (ADR-045): the
 * data is a static committed file nothing joins against, so a table would buy a loader, a
 * migration and a network round trip on the hot path of a workout upload for no benefit.
 *
 * A search never scans the whole list. It binary-searches the band of latitudes within reach
 * (distance is at least R times the latitude difference, so the band is exact, not a guess), then
 * rejects on a longitude bound that wraps the antimeridian, and only then does the trigonometry.
 */
export function buildCityIndex(snapshot: NormalizedCities): CityIndex {
  const { rows } = snapshot;
  const latitudes = new Float64Array(rows.length);
  const longitudes = new Float64Array(rows.length);
  rows.forEach((row, i) => {
    latitudes[i] = row[ROW.latitude];
    longitudes[i] = row[ROW.longitude];
    if (i > 0 && latitudes[i - 1]! > latitudes[i]!) {
      throw new Error(`city snapshot is not sorted by latitude (row ${i}); the search depends on it`);
    }
  });

  return {
    size: rows.length,
    nearest(latitude, longitude, maxKm) {
      if (!isValidQuery(latitude, longitude, maxKm) || rows.length === 0) return null;

      const angular = maxKm / EARTH_RADIUS_KM; // radians of arc
      const bandDegrees = toDegrees(angular);
      const start = lowerBound(latitudes, latitude - bandDegrees);

      // From haversine: sin(d / 2R) >= cos(phiMax) * sin(dLon / 2), so a candidate within `maxKm`
      // differs in longitude by at most 2 * asin(sin(angular / 2) / cos(phiMax)), where phiMax
      // is the highest latitude any candidate in the band can have.
      const phiMax = Math.min(90, Math.abs(latitude) + bandDegrees);
      const cosPhiMax = Math.cos(toRadians(phiMax));
      // cos(90 degrees) is a tiny positive number in floating point, so this divides safely and the
      // ratio simply exceeds 1 at the poles, which disables the longitude bound.
      const ratio = Math.sin(angular / 2) / cosPhiMax;
      const maxLongitudeDelta = ratio >= 1 ? 360 : toDegrees(2 * Math.asin(ratio));

      let best: { index: number; distanceKm: number; population: number; geonameId: number } | null = null;
      for (let i = start; i < rows.length && (latitudes[i] as number) <= latitude + bandDegrees; i += 1) {
        let delta = Math.abs((longitudes[i] as number) - longitude);
        if (delta > 180) delta = 360 - delta;
        if (delta > maxLongitudeDelta) continue;

        const row = rows[i] as NormalizedCities['rows'][number];
        const distanceKm = haversineKm(latitude, longitude, latitudes[i] as number, longitudes[i] as number);
        if (distanceKm > maxKm) continue;
        if (best === null || isBetter(distanceKm, row[ROW.population], row[ROW.geonameId], best)) {
          best = { index: i, distanceKm, population: row[ROW.population], geonameId: row[ROW.geonameId] };
        }
      }
      return best === null ? null : toMatch(snapshot, rows[best.index] as NormalizedCities['rows'][number], best.distanceKm);
    },
  };
}
