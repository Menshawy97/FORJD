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
