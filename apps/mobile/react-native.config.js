// React Native autolinking overrides (read by Expo's autolinking for the native builds).
//
// ADR-069: Apple Health's library and its peer link only into an iPhone build that switches Apple
// Health on (APPLE_HEALTH_ENABLED, the same switch app.config.ts reads). Switched off, the iPhone app
// holds no HealthKit code, so App Store checks see nothing undeclared. They never link into Android:
// react-native-nitro-modules ships Android native code too, and leaving it out keeps the Android app
// linking exactly the native modules it did before. config/__tests__/apple-health-config.test.ts
// checks both platforms, switched on and off.
const appleHealthEnabled = process.env.APPLE_HEALTH_ENABLED === 'true';
const iosOnlyWhenSwitchedOn = { android: null, ...(appleHealthEnabled ? {} : { ios: null }) };

module.exports = {
  dependencies: {
    'react-native-nitro-modules': { platforms: iosOnlyWhenSwitchedOn },
    '@kingstinct/react-native-healthkit': { platforms: iosOnlyWhenSwitchedOn },
  },
};
