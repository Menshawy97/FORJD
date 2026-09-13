import { renderRouter, type RenderRouterOptions } from 'expo-router/testing-library';

/**
 * Shared route-tree test harness (R17). Renders `src/app` and fixes the one thing every
 * `renderRouter()`-based test in this directory needs and none of them controlled: real time.
 *
 * `renderRouter()` unconditionally calls `jest.useFakeTimers()` before rendering (a workaround
 * for https://github.com/expo/expo/issues/46864, so the initial synchronous render sees a frozen
 * clock) and never switches back. Every route-tree test was inheriting fake-timer mode for its
 * *entire* lifetime as a result, including every `findByText` / `waitFor` call made after the
 * screen had already mounted.
 *
 * That matters because `@testing-library/react-native`'s `waitFor` behaves completely
 * differently under fake timers. With real timers it polls on a real `setInterval`, bounded by a
 * real `setTimeout` at `asyncUtilTimeout` (see `jest/testing-library-setup.js`) — a genuine
 * wall-clock deadline. With fake timers it instead drives a `while` loop that advances *fake*
 * time in fixed steps, each step awaiting a real `act()` call plus a microtask flush. That loop's
 * real wall-clock duration is unbounded: it only stops once fake time runs out, never because
 * real time did. Under CPU contention (parallel workers, a machine already busy with other work)
 * each step can take far longer in wall-clock terms than the 50ms of fake time it represents, so
 * the loop can legitimately run for minutes.
 *
 * When that happens, Jest's own per-test timeout (a real-time mechanism, unrelated to the fake
 * clock) can fire first and tear the test environment down while the loop is still mid-flight.
 * Its next iteration then tries to `require('react-native')` internals and throws "You are
 * trying to `import` a file after the Jest environment has been torn down" — a confusing crash
 * that replaces what should have been a plain "unable to find element" failure, and the exact
 * "real post-teardown import leak" this harness exists to prevent.
 *
 * The fix: flip back to real timers the moment the initial render settles, before any
 * interaction or assertion runs. From then on every wait in the test is bounded by a real,
 * finite deadline — it fails fast and cleanly instead of racing Jest's outer timeout.
 *
 * `renderRouter()`'s return value is a real Promise with navigation helpers
 * (`getPathname()` etc.) attached to the Promise object itself, so existing call sites rely on
 * being able to read those helpers off the *unawaited* reference while separately `await`-ing it
 * for the render result. This returns that exact same object unchanged — only a `.then()`
 * listener is attached, so `renderApp(...)` is a drop-in replacement for
 * `renderRouter('src/app', ...)` at every call site, whether or not the caller keeps an
 * unawaited reference around.
 */
export function renderApp(options: RenderRouterOptions) {
  const rendered = renderRouter('src/app', options);
  // Registered before control returns to the caller, so this listener resolves — and real
  // timers are restored — before the caller's own `await rendered` continuation resumes.
  void rendered.then(() => {
    jest.useRealTimers();
  }, () => {
    // The render itself failed; let the caller's `await rendered` surface that error normally.
  });
  return rendered;
}
