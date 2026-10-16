// React Native autolinking overrides (read by Expo's autolinking for the native builds).
//
// ADR-069: Apple Health's library and its peer are iPhone only for FORJD. react-native-nitro-modules
// ships Android native code too; leaving it out of Android keeps the Android app linking exactly the
// native modules it did before. config/__tests__/apple-health-config.test.ts checks both platforms.
module.exports = {
  dependencies: {
    'react-native-nitro-modules': { platforms: { android: null } },
    '@kingstinct/react-native-healthkit': { platforms: { android: null } },
  },
};
