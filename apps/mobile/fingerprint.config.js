// @ts-check
/* global module, require -- loaded by Node through @expo/fingerprint. */
/**
 * What counts as "the native layer" for the runtime version (ADR-070). An over-the-air update reaches
 * only a build whose fingerprint is identical, so this file decides when a change needs a store build.
 *
 * On top of Expo's default, four things are left out because none of them reaches native code:
 * - `extra` in app.config.ts: JavaScript reads it through expo-constants, and an update carries its own
 *   copy in its manifest. It also differs between staging and production (the API address), which
 *   would otherwise give each profile its own fingerprint for no reason.
 * - package.json `scripts`: adding a script is not a native change.
 * - eas.json: its build `env` lands in `extra`, and anything it adds to native code (a plugin switched on
 *   by a variable) already shows up in the plugins list, which stays in.
 * - config/api-base-url.js: the build's address check. app.config.ts loads it, so it would count, but it
 *   only decides whether a build or update may go ahead.
 */
const { DEFAULT_IGNORE_PATHS, DEFAULT_SOURCE_SKIPS, SourceSkips } = require('expo/fingerprint');

/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: DEFAULT_SOURCE_SKIPS | SourceSkips.ExpoConfigExtraSection | SourceSkips.PackageJsonScriptsAll,
  ignorePaths: [...DEFAULT_IGNORE_PATHS, 'eas.json', 'config/api-base-url.js'],
};

module.exports = config;
