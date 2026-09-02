import type { ExpoConfig } from 'expo/config';

// Fresh bundle identifier / package name (CLAUDE.md pivot notes, ADR-013): no existing App
// Store / Play Store registration to preserve, so these are placeholders, not a migration
// from a real listing.
const config: ExpoConfig = {
  owner: 'forjd',
  name: 'FORJD',
  slug: 'forjd-mobile',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'forjd',
  // Dark-only: the design has a single palette and no light variant, so 'automatic' could
  // only ever mean "let the OS draw light chrome around a dark app". See _layout.tsx, which
  // passes DarkTheme unconditionally for the same reason.
  userInterfaceStyle: 'dark',
  ios: {
    bundleIdentifier: 'com.forjd.app',
    icon: './assets/expo.icon',
    // The nutrition share-card's background-photo picker is the first feature to call
    // `expo-image-picker`'s `launchCameraAsync` -- the existing gallery-only usages
    // (edit-profile.tsx, pick-username.tsx) never needed this string. iOS refuses camera
    // access outright with no system prompt at all if this is missing.
    infoPlist: {
      NSCameraUsageDescription: 'FORJD uses your camera to let you take a photo for your nutrition share card background.',
    },
  },
  android: {
    package: 'com.forjd.app',
    adaptiveIcon: {
      backgroundColor: '#08090A',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    'expo-sqlite',
    '@react-native-community/datetimepicker',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#08090A',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    // The only value read here — no secrets ship in the mobile app (CLAUDE.md rule 5).
    // OpenAI/WHOOP/Supabase secrets stay server-side; the mobile app only ever talks to
    // apps/api, never a third-party API directly.
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000',
    eas: {
      projectId: '971ed96d-2f88-42e2-bcbf-1643ba5d8fa2',
    },
  },
};

export default config;
