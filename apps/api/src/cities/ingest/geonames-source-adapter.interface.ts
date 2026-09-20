/**
 * One populated place from the vendored GeoNames `cities15000` export, in FORJD's own words.
 * Nothing downstream of the adapter sees GeoNames' column layout (ADR-045).
 */
export interface GeonamesCity {
  geonameId: number;
  name: string;
  latitude: number;
  longitude: number;
  /**
   * GeoNames feature code: PPL, PPLA, PPLC and so on. `PPLX` means a section of a populated
   * place (a district), which the normalizer excludes so it cannot split a city (ADR-045).
   */
  featureCode: string;
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode: string;
  /** First-level administrative division code (a US state, an Egyptian governorate), if any. */
  admin1: string | null;
  population: number;
  /** IANA timezone id. It is what defines "this month" for a city's leaderboard. */
  timezone: string;
}
