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
    // ADR-052: the same DARK-tile PNG as every other platform (this used to point at the Expo
    // template's untouched Icon Composer bundle, which still drew the Expo logo).
    icon: './assets/images/icon.png',
    // The nutrition share-card's background-photo picker is the first feature to call
    // `expo-image-picker`'s `launchCameraAsync` -- the existing gallery-only usages
    // (edit-profile.tsx, pick-username.tsx) never needed this string. iOS refuses camera
    // access outright with no system prompt at all if this is missing.
    infoPlist: {
      NSCameraUsageDescription: 'FORJD uses your camera to let you take a photo for your nutrition share card background.',
      // R29 audit remediation (ADR-038): missing on Apple's checklist was a genuine App Store
      // submission rejection risk, since inbody.tsx's `pickFromLibrary` already calls
      // `ImagePicker.launchImageLibraryAsync` to attach an InBody scan photo -- iOS refuses
      // library access outright with no system prompt at all if this key is missing, the same
      // failure mode NSCameraUsageDescription above already documents for the camera.
      NSPhotoLibraryUsageDescription:
        'FORJD needs access to your photo library so you can attach a photo of your InBody scan.',
    },
  },
  android: {
    package: 'com.forjd.app',
    adaptiveIcon: {
      backgroundColor: '#1B1B1D',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // ADR-048 / ADR-049: location is foreground only, never in the background. The expo-location
    // plugin declares background location by default, so it is blocked. Fine location is allowed
    // (it was blocked before runs): the run screen needs a precise position while a run is open,
    // and the leaderboard path still asks for a coarse one.
    blockedPermissions: ['android.permission.ACCESS_BACKGROUND_LOCATION'],
    // R8 / ADR-034 / ADR-050: a run reads the watch's heart rate and active energy through Health
    // Connect, read-only, once the person allows it. Nothing else is declared and nothing is written.
    // Unverified on a physical phone (ADR-035), like the rest of the Health Connect adapter.
    permissions: ['android.permission.health.READ_HEART_RATE', 'android.permission.health.READ_ACTIVE_CALORIES_BURNED'],
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
    // Local notifications only -- the rest timer's "rest complete" alert (ADR-026). No push
    // registration, no device token, no server involvement.
    'expo-notifications',
    // Required as a config plugin from SDK 57; it was implicit before. The app opens the WHOOP
    // OAuth flow and external links through it.
    'expo-web-browser',
    // ADR-041: native Google sign-in. Android needs no plugin options; iOS needs the reversed
    // client ID as a URL scheme, so it is added only when configured (iOS ships later, ADR-007).
    process.env.GOOGLE_IOS_URL_SCHEME
      ? ['@react-native-google-signin/google-signin', { iosUrlScheme: process.env.GOOGLE_IOS_URL_SCHEME }]
      : '@react-native-google-signin/google-signin',
    '@react-native-community/datetimepicker',
    // ADR-048 / ADR-049: one coarse position at the start of a workout, to place the athlete on a
    // city leaderboard, and a precise one while a run is open. Foreground only; the Android
    // background permission is blocked above. The purpose string is what the system dialog shows,
    // so it says exactly what the app does with the position.
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'FORJD uses your approximate location once, at the start of a workout, to place you on your city leaderboard, and your precise location while a run is open, to measure distance, pace and your route. Your route stays on your phone and is never uploaded.',
        isAndroidBackgroundLocationEnabled: false,
        // ADR-059: a run keeps tracking with the screen off through a location foreground service,
        // started only from the visible run screen. It adds FOREGROUND_SERVICE and
        // FOREGROUND_SERVICE_LOCATION and nothing else; ACCESS_BACKGROUND_LOCATION stays blocked
        // (checked with a real prebuild, 2026-10-03). The FORJD symbol is its notification icon.
        isAndroidForegroundServiceEnabled: true,
        androidForegroundServiceIcon: './assets/images/android-icon-monochrome.png',
        // The iOS equivalent: the "location" background mode with When In Use only, the blue
        // status-bar pill, never "Always" (the Always strings below stay deleted).
        isIosBackgroundLocationEnabled: true,
        // The plugin adds the iOS "Always" and motion purpose strings by default even with
        // background location off. `false` deletes the key, so the app does not claim a use it
        // does not have (iOS ships later, ADR-007, but the config should already be right).
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
      },
    ],
    // ADR-050: Google's street map under a run's route, on Android. The key is a client key
    // (restricted to this app's package and signing SHA-1 in the Google Cloud console, so it is
    // not a secret), supplied as the EAS environment variable GOOGLE_MAPS_ANDROID_API_KEY and
    // never committed. Without one the plugin is left out and the route map falls back to the
    // striped background, so the app builds either way. No iOS key: iOS ships later (ADR-007).
    ...(process.env.GOOGLE_MAPS_ANDROID_API_KEY
      ? [['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }] as [string, Record<string, unknown>]]
      : []),
    [
      'expo-splash-screen',
      {
        // ADR-052: Ink, the #9 intro's own background, with a transparent image -- the native
        // splash hands over to the intro's first frame without a visible change.
        backgroundColor: '#101011',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    // ADR-028: real Save Image / Instagram / More on both share screens. `savePhotosPermission`
    // is the only string actually needed -- the screens only ever write to the library, never
    // read from it, unlike the nutrition background-photo picker's separate gallery permission.
    [
      'expo-media-library',
      {
        savePhotosPermission: 'FORJD saves your share card to Photos when you tap Save Image.',
        isAccessMediaLocationEnabled: false,
      },
    ],
    'expo-sharing',
    // Phase 6F / ADR-034: the Android Health Connect adapter. `expo-build-properties`'
    // Android SDK levels are the versions the library's own install instructions call for.
    'react-native-health-connect',
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          minSdkVersion: 26,
        },
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
    // ADR-041. The Google OAuth *web* client ID: public by design (it identifies the app to
    // Google and is visible in every Google sign-in request), so it is not a secret and may
    // ship in the bundle. The client secret lives only in the Supabase dashboard. Empty until
    // Google Cloud is set up, in which case the button says the app build is needed.
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID ?? '',
    // Sign in with Apple is built but stays off until a paid Apple Developer account exists;
    // flipping this to true (plus adding the entitlement plugin) turns it on with no code change.
    appleSignInEnabled: process.env.APPLE_SIGN_IN_ENABLED === 'true',
    // ADR-050. Only whether a Google Maps key was configured, never the key: `extra` ships as
    // readable JSON, and the key already lives in the Android manifest via the plugin above.
    hasMapsKey: Boolean(process.env.GOOGLE_MAPS_ANDROID_API_KEY),
    eas: {
      projectId: '971ed96d-2f88-42e2-bcbf-1643ba5d8fa2',
    },
  },
};

export default config;
