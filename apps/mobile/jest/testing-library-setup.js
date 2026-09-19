// R17: `@testing-library/react-native`'s default `asyncUtilTimeout` (1000ms) is a real-time
// bound, checked against the wall clock via a real `setTimeout`/`setInterval` pair (see
// `wait-for.js` in the library — the fake-timer branch that used to make this number
// meaningless for route-tree tests no longer runs past `renderApp()`, see
// `src/app/__tests__/render-app.ts`).
//
// 1000ms is tight for `renderRouter()`-based tests: they build and mount the app's entire route
// tree, which is legitimately slower than a single-component render even before accounting for
// a CPU-contended dev machine or CI runner. Raising it gives real work room to finish while
// staying a genuine, finite deadline — a slow assertion now fails cleanly with "unable to find
// element" well inside Jest's own per-test timeout, instead of exceeding it.
const { configure } = require('@testing-library/react-native');

configure({ asyncUtilTimeout: 10000 });

// Phase 8 / 8B: `src/store/local-data.ts` (wiping on-device data when an account is deleted or
// an under-age sign-up is turned away) imports AsyncStorage, and `pick-username.tsx` now
// imports that -- so every route-tree test that loads the app's routes reaches the native
// module. This is the library's own documented Jest mock; suites that mock AsyncStorage
// themselves (the store tests) override it with their own factory as before.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
