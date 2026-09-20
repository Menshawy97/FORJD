import { Inject, Injectable } from '@nestjs/common';

import { CityIndex, buildCityIndex } from './city-index';
import { NormalizedCities } from './ingest/normalize-cities';

/** Injection token for the function that produces the snapshot, so tests need not touch the disk. */
export const CITY_SNAPSHOT_LOADER = Symbol('CITY_SNAPSHOT_LOADER');

/**
 * Farther than this from any place in the list and a position is not in a city at all (open
 * water, desert, a mountain pass): better to place nobody than to file them under a town two
 * hours away (ADR-045).
 */
export const MAX_CITY_DISTANCE_KM = 120;

/** All a caller learns. The distance and the GeoNames id stay inside. */
export interface ResolvedCity {
  name: string;
  slug: string;
  countryCode: string;
  timezone: string;
}

/**
 * Turns a coarse position into the city it belongs to, on our own server, so no coordinate is
 * ever sent to a third party (ADR-045, and the reason no geocoding API is used).
 *
 * The index is built lazily on the first call, not at construction: building it parses a 2.6 MB
 * file, and doing that at import time would slow `nest start`, every jest suite that builds the
 * DI graph, and a cold Cloud Run start. A failed load is not remembered, so a transient problem
 * does not disable resolution until the next deploy.
 */
@Injectable()
export class CityResolverService {
  private index: CityIndex | null = null;

  constructor(@Inject(CITY_SNAPSHOT_LOADER) private readonly loadSnapshot: () => NormalizedCities) {}

  resolve(latitude: number, longitude: number): ResolvedCity | null {
    const match = this.getIndex().nearest(latitude, longitude, MAX_CITY_DISTANCE_KM);
    if (match === null) return null;
    return { name: match.name, slug: match.slug, countryCode: match.countryCode, timezone: match.timezone };
  }

  private getIndex(): CityIndex {
    if (this.index === null) this.index = buildCityIndex(this.loadSnapshot());
    return this.index;
  }
}
