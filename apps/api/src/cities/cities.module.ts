import { Module } from '@nestjs/common';

import { loadCitySnapshotFromDisk } from './city-snapshot';
import { CITY_SNAPSHOT_LOADER, CityResolverService } from './city-resolver.service';

/**
 * Resolves a coarse position to a city (ADR-045). The loader is provided as a function so the
 * snapshot is read on first use rather than when the module is created. Imported by the
 * workouts module, which resolves a session's city on upload.
 */
@Module({
  providers: [{ provide: CITY_SNAPSHOT_LOADER, useValue: loadCitySnapshotFromDisk }, CityResolverService],
  exports: [CityResolverService],
})
export class CitiesModule {}
