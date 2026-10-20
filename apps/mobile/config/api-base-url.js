// @ts-check
/* global module, URL -- loaded by Node through Expo's config loader. */
/**
 * The build-time check on the API address (docs/product/beta-readiness-plan.md, part 1).
 *
 * `app.config.ts` calls this with `EAS_BUILD_PROFILE` and `API_BASE_URL` and fails the build when
 * it returns a reason. Only production builds are checked: development and staging point at a
 * computer or at staging on purpose. `production-apk` is production built as an installable APK
 * (an emulator or a phone outside Play), so it is checked the same way.
 *
 * Plain CommonJS on purpose: Expo's config loader compiles `app.config.ts` itself but not the
 * TypeScript files it imports, so anything the config imports has to be JavaScript. The types live
 * in `api-base-url.d.ts`.
 */
const THIS_COMPUTER_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2', '[::1]']);

/**
 * Returns why `url` cannot be a production build's API address, or null when it can.
 * @param {string | undefined} profile
 * @param {string | undefined} url
 * @returns {string | null}
 */
function checkApiBaseUrl(profile, url) {
  if (profile !== 'production' && profile !== 'production-apk') return null;
  if (!url) return 'API_BASE_URL is not set';
  if (url.startsWith('REPLACE_')) return 'API_BASE_URL is still the placeholder';

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return `API_BASE_URL is not an address: ${url}`;
  }
  if (THIS_COMPUTER_HOSTS.has(parsed.hostname)) return `API_BASE_URL points at this computer: ${url}`;
  if (parsed.hostname.includes('staging')) return `API_BASE_URL points at staging: ${url}`;
  if (parsed.protocol !== 'https:') return `API_BASE_URL must use https: ${url}`;
  return null;
}

module.exports = { checkApiBaseUrl };
