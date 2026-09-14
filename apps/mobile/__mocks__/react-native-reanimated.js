// R21: manual Jest mock for `react-native-reanimated`, picked up automatically for this
// node_modules package because it lives in a `__mocks__` directory adjacent to the project
// root (Jest's documented convention -- no `jest.mock()` call needed at each test's call site).
//
// The package's own `mock.js` (referenced by Reanimated's docs for older versions) pulls in
// real, non-type value exports from its `./index` entry point to reuse pure-JS helpers, and
// that entry point eagerly initializes the native worklets runtime at module scope -- which
// does not exist under Jest and throws before a single test can run. This mock instead provides
// only the handful of APIs `countdown-ring.tsx` actually uses, running synchronously on the JS
// thread with no native dependency at all.
const React = require('react');
const { View } = require('react-native');

function useSharedValue(initial) {
  const ref = React.useRef({ value: initial });
  return ref.current;
}

function useAnimatedProps(factory) {
  return factory();
}

function withTiming(toValue) {
  return toValue;
}

const Easing = {
  linear: (t) => t,
};

const Animated = {
  View,
  createAnimatedComponent: (Component) => Component,
};

module.exports = {
  __esModule: true,
  default: Animated,
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
};
