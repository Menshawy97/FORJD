// @ts-check
/* global module, require, process -- loaded by Node through @expo/fingerprint. */
/**
 * What counts as "the native layer" for the runtime version (ADR-071). An over-the-air update reaches
 * only a build whose fingerprint is identical, so this file decides when a change needs a store build.
 *
 * On top of Expo's default, five things are left out because none of them reaches native code:
 * - `extra` in app.config.ts: JavaScript reads it through expo-constants, and an update carries its own
 *   copy in its manifest. It also differs between staging and production (the API address), which
 *   would otherwise give each profile its own fingerprint for no reason.
 * - package.json `scripts`: adding a script is not a native change.
 * - eas.json: its build `env` lands in `extra`, and anything it adds to native code (a plugin switched on
 *   by a variable) already shows up in the plugins list, which stays in.
 * - config/api-base-url.js: the build's address check. app.config.ts loads it, so it would count, but it
 *   only decides whether a build or update may go ahead.
 * - the Firebase file (GOOGLE_SERVICES_JSON): an EAS secret file, so EAS's builders have it but a local
 *   command never does (EAS does not hand out secret files), and the fingerprint would never match. It
 *   holds Firebase project IDs, not code, and it is set for every profile. Matched by its file name,
 *   since EAS keeps it outside the project.
 */
const { basename } = require('node:path');

const { DEFAULT_IGNORE_PATHS, DEFAULT_SOURCE_SKIPS, SourceSkips } = require('expo/fingerprint');

const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;

/** @type {import('expo/fingerprint').Config} */
const config = {
  sourceSkips: DEFAULT_SOURCE_SKIPS | SourceSkips.ExpoConfigExtraSection | SourceSkips.PackageJsonScriptsAll,
  ignorePaths: [
    ...DEFAULT_IGNORE_PATHS,
    'eas.json',
    'config/api-base-url.js',
    ...(googleServicesFile ? [`**/${basename(googleServicesFile)}`] : []),
  ],
};

module.exports = config;
