import { NORMALIZED_COLUMNS, NormalizedCities } from './ingest/normalize-cities';
import { CityResolverService, MAX_CITY_DISTANCE_KM } from './city-resolver.service';

const snapshot = (): NormalizedCities => ({
  source: 'test',
  pin: 'test',
  count: 2,
  dropped: { noSlug: 0, orphanSection: 0 },
  columns: [...NORMALIZED_COLUMNS],
  timezones: ['Africa/Cairo', 'Europe/Rome'],
  rows: [
    [1, 'Cairo', 'EG', 30.06, 31.25, 9_606_916, 0, 'cairo-eg-1'],
    [2, 'Rome', 'IT', 41.89, 12.48, 2_872_800, 1, 'rome-it-2'],
  ],
});

describe('CityResolverService', () => {
  it('caps a match at 120 km', () => {
    expect(MAX_CITY_DISTANCE_KM).toBe(120);
  });

  it('resolves coordinates to the city, its slug and its timezone', () => {
    const service = new CityResolverService(snapshot);
    expect(service.resolve(30.05, 31.24)).toEqual({
      name: 'Cairo',
      slug: 'cairo-eg-1',
      countryCode: 'EG',
      timezone: 'Africa/Cairo',
    });
  });

  it('does not expose the distance or the id to callers', () => {
    const resolved = new CityResolverService(snapshot).resolve(41.9, 12.5);
    expect(Object.keys(resolved ?? {}).sort()).toEqual(['countryCode', 'name', 'slug', 'timezone']);
  });

  it('returns null when no city is within reach', () => {
    expect(new CityResolverService(snapshot).resolve(0, -30)).toBeNull();
  });

  it('returns null for coordinates that are not real', () => {
    const service = new CityResolverService(snapshot);
    expect(service.resolve(Number.NaN, 0)).toBeNull();
    expect(service.resolve(95, 0)).toBeNull();
  });

  it('does not load the snapshot until the first resolve, so start-up stays fast', () => {
    const loader = jest.fn(snapshot);
    new CityResolverService(loader);
    expect(loader).not.toHaveBeenCalled();
  });

  it('builds the index once across many calls', () => {
    const loader = jest.fn(snapshot);
    const service = new CityResolverService(loader);
    for (let i = 0; i < 1000; i += 1) service.resolve(30.05, 31.24);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('propagates a load failure, and tries again next time rather than caching the failure', () => {
    const loader = jest
      .fn<NormalizedCities, []>()
      .mockImplementationOnce(() => {
        throw new Error('snapshot missing');
      })
      .mockImplementation(snapshot);
    const service = new CityResolverService(loader);
    expect(() => service.resolve(30.05, 31.24)).toThrow('snapshot missing');
    expect(service.resolve(30.05, 31.24)?.name).toBe('Cairo');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('is a pure function of its arguments', () => {
    const service = new CityResolverService(snapshot);
    expect(service.resolve(30.05, 31.24)).toEqual(service.resolve(30.05, 31.24));
  });
});
