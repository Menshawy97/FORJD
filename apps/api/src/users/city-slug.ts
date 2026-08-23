/**
 * Turns a volunteered city name into a stable grouping key for future leaderboards
 * (Phase 10) — no `cities` table exists yet, so this is the only grouping mechanism.
 *
 * Diacritics are stripped from Latin script (`Zürich` -> `zurich`, `São Paulo` -> `sao-paulo`)
 * so two spellings of the same city group together, which is the entire reason this function
 * exists. Characters outside Latin script (`北京`, `Москва`) are lowercased and kept as-is
 * rather than dropped: discarding them would collapse every non-Latin city name to the same
 * empty string, which is worse than leaving the script untouched. No transliteration library
 * is in this dependency tree, so romanizing non-Latin script is out of scope.
 *
 * Returns null, never an empty string, when nothing slugifiable remains (pure punctuation, or
 * whitespace). `''` is falsy but is not "no slug" — every such name would otherwise collide
 * into one group — so the caller gets an explicit null to decide what that means.
 */
export function slugifyCity(city: string): string | null {
  const slug = city
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritical marks, stripped after NFKD decomposition
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : null;
}
