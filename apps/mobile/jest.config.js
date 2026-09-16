/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // global.css (and any other stylesheet) is a Metro/web asset — NativeWind compiles
  // `className` props via the `nativewind/babel` transform at build time, so the actual
  // .css file has nothing to contribute inside Jest and just needs to not blow up the
  // parser when imported for its side effect.
  moduleNameMapper: {
    '\\.css$': '<rootDir>/jest/css-stub.js',
  },
  // R17: `render-app.ts` is a shared test harness beside the `__tests__` files it supports,
  // not a test itself -- it has no `it`/`describe` blocks, so Jest's default testMatch
  // (which globs every file under `__tests__`) picked it up and failed the run with "must
  // contain at least one test".
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/app/__tests__/render-app.ts'],
  // R11 (ADR-039): the `pnpm-workspace.yaml` audit-triage overrides forced `decode-uri-component`
  // and `uuid` to versions that ship ESM-only (`"type": "module"`) -- `decode-uri-component`
  // reaches the graph via `query-string`, a real `expo-router` dependency (not just the
  // drizzle-orm/expo-sqlite chain ADR-039 assumed), and `uuid` via `xcode` in `@expo/config-plugins`,
  // both loaded transitively when tests import `expo-router/testing-library`. `jest-expo`'s preset
  // `transformIgnorePatterns` only carves out react-native/expo-family packages for transformation
  // (see its `jest-preset.js`); everything else under pnpm's nested `node_modules/.pnpm/<pkg>/node_modules/<pkg>`
  // layout still matches the ignore pattern and fails with "Unexpected token 'export'". Re-declaring
  // the preset's pattern here with these two packages added is the standard fix for this exact class
  // of RN/Expo Jest failure -- it transforms their ESM to CJS for the test runner without touching
  // the security-motivated version floor in `pnpm-workspace.yaml`.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|decode-uri-component|uuid))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
  // R17: bumps `@testing-library/react-native`'s `asyncUtilTimeout` (see the setup file for
  // why 1000ms is tight for route-tree tests). Route tests also switch back to real timers via
  // `src/app/__tests__/render-app.ts` so that bound is real wall-clock time, not fake time —
  // see that file for the failure mode this replaces.
  setupFilesAfterEnv: ['<rootDir>/jest/testing-library-setup.js'],
  // `renderRouter()` builds the app's entire route tree (every file under src/app) on each
  // call, which legitimately takes seconds — well past Jest's 5s default once several
  // worker processes contend for CPU. This stays as an outer safety net now that individual
  // waits are bounded by the real, finite `asyncUtilTimeout` above rather than racing this
  // number directly — a test that is actually broken now fails on its own assertion long
  // before hitting this ceiling, instead of surfacing as an indistinguishable timeout.
  testTimeout: 60000,
};
