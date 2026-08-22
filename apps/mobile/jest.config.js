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
  // `renderRouter()` builds the app's entire route tree (every file under src/app) on each
  // call, which legitimately takes seconds — well past Jest's 5s default once several
  // worker processes contend for CPU. Every failure that default produced was a timeout,
  // never an assertion, and which suites tripped varied run to run: a flake, not a bug.
  testTimeout: 30000,
};
