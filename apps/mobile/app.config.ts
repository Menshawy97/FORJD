import type { ExpoConfig } from 'expo/config';

import { checkApiBaseUrl } from './config/api-base-url';

// docs/product/beta-readiness-plan.md, part 1: a production build that would reach a placeholder,
// this computer or staging fails here, before anything is built or shipped. An over-the-air update is
// checked the same way: scripts/publish-update.js names its profile in FORJD_UPDATE_PROFILE (ADR-071).
const apiBaseUrlProblem = checkApiBaseUrl(
  process.env.EAS_BUILD_PROFILE ?? process.env.FORJD_UPDATE_PROFILE,
  process.env.API_BASE_URL,
);
if (apiBaseUrlProblem) {
  throw new Error(`Production build refused: ${apiBaseUrlProblem}. Set it in eas.json's production profile.`);
}

// ADR-069: Apple Health is merged switched off. Only a build with APPLE_HEALTH_ENABLED=true (none in
// eas.json until the iPhone walk) declares HealthKit, so a build that does not use it never asks for it.
const appleHealthEnabled = process.env.APPLE_HEALTH_ENABLED === 'true';

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
    // FORJD uses only HTTPS (exempt encryption), so App Store Connect stops asking on every upload.
    config: { usesNonExemptEncryption: false },
    // Each purpose string names every use (App Review 5.1.1(ii)); iOS refuses access with no prompt
    // when one is missing. Camera: inbody.tsx and nutrition-share.tsx. Photo library: inbody.tsx,
    // edit-profile.tsx, pick-username.tsx and nutrition-share.tsx. Wording approved by the owner
    // 2026-10-16 (ios-no-account-plan.md); config/__tests__/ios-settings.test.ts checks each use.
    infoPlist: {
      NSCameraUsageDescription:
        'FORJD uses your camera to take a photo of your InBody scan result, or a photo for your nutrition share card background.',
      NSPhotoLibraryUsageDescription:
        'FORJD opens your photo library so you can choose a photo of your InBody scan, your profile photo, or a background for your nutrition share card.',
    },
  },
  android: {
    package: 'com.forjd.app',
    // Phase 12F: Android push is delivered through Firebase (FCM). The file comes from the EAS file variable GOOGLE_SERVICES_JSON
    // (its value is a path; locally, point it at apps/mobile/google-services.json, which is gitignored). Left out when not
    // supplied, so a build without push still works. iOS gets push from Apple through Expo and needs no such file.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
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
    // FORJD never records audio and never reads the photo library (photos come through the system
    // picker; share cards are only saved). expo-image-picker and expo-media-library add these by
    // default, and Play's Photo and Video Permissions policy allows READ_MEDIA_IMAGES/VIDEO only when
    // the picker cannot do the job, so they are removed however they arrive (ios-settings-gaps.md).
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
    ],
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
    // FORJD never asks for Face ID; by default the plugin adds a generic iPhone Face ID prompt.
    // `false` deletes it. iPhone only: the plugin's Android backup rules are unchanged.
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-font',
    'expo-sqlite',
    // Local notifications only: the rest timer's "rest complete" alert (ADR-026) and the live run
    // notice (12A-3). No push registration yet (ADR-060, slice 12F). The FORJD symbol in ember is
    // their icon, as the approved replica v2 shows (2026-10-03).
    ['expo-notifications', { icon: './assets/images/android-icon-monochrome.png', color: '#E9712F' }],
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
    // striped background, so the app builds either way. No iOS key is needed: iPhone draws Apple Maps
    // (MapKit), which takes none (ADR-050 amendment).
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
        // Saving needs no read permission (share-capture.ts asks write-only).
        granularPermissions: [],
      },
    ],
    // Applied automatically by prebuild even when unlisted, and by default it adds a microphone
    // permission (Android RECORD_AUDIO, an iPhone prompt) for video FORJD never records. Listed here
    // only to turn that off; the camera and photo strings stay in `ios.infoPlist` above.
    ['expo-image-picker', { microphonePermission: false }],
    'expo-sharing',
    // 12C's background upload (src/integrations/background/background-upload.ts). Not applied
    // automatically: without it the iPhone build lacks the `processing` background mode and the task
    // identifier iOS requires before it schedules the task. It edits only the iPhone Info.plist.
    'expo-background-task',
    // ADR-068 / ADR-069: Apple Health, read only, and only when switched on. The share text is what the
    // iPhone permission sheet shows; no update (write) text and no background delivery, since FORJD
    // reads only, while the app is open. Wording approved by the owner 2026-10-17 (ADR-069).
    ...(appleHealthEnabled
      ? [
          [
            '@kingstinct/react-native-healthkit',
            {
              NSHealthShareUsageDescription:
                'FORJD reads your heart rate and active energy during a run, and your resting heart rate, heart rate variability, sleep, respiratory rate, steps, weight and VO2 max for your readiness and progress. FORJD never writes to Apple Health.',
              NSHealthUpdateUsageDescription: false,
              background: false,
            },
          ] as [string, Record<string, unknown>],
        ]
      : []),
    // Phase 6F / ADR-034: the Android Health Connect adapter. `expo-build-properties`'
    // Android SDK levels are the versions the library's own install instructions call for.
    // The library's own config plugin is deliberately not listed: it only adds the "privacy policy"
    // intent filter and alias, pointed at MainActivity. modules/forjd-health-rationale declares
    // both instead, on an activity that opens the policy (health-connect-privacy-link-plan.md).
    // The library's native code still links through its expo-module.config.json.
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
  // ADR-071: over-the-air updates for JavaScript-only changes. The runtime version is the fingerprint
  // of the native layer, so an update reaches only builds with exactly the same native code; anything
  // native still ships through the stores. `fallbackToCacheTimeout: 0`: launch never waits for the
  // network (rule 6). A new bundle downloads in the background and runs from the next cold start, so a
  // live workout is never reloaded under the athlete.
  runtimeVersion: { policy: 'fingerprint' },
  updates: {
    url: 'https://u.expo.dev/971ed96d-2f88-42e2-bcbf-1643ba5d8fa2',
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
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
    // ADR-069. Whether this build may use Apple Health; getDeviceHealthProvider() reads it on iPhone.
    appleHealthEnabled,
    // ADR-050. Only whether a Google Maps key was configured, never the key: `extra` ships as
    // readable JSON, and the key already lives in the Android manifest via the plugin above.
    hasMapsKey: Boolean(process.env.GOOGLE_MAPS_ANDROID_API_KEY),
    eas: {
      projectId: '971ed96d-2f88-42e2-bcbf-1643ba5d8fa2',
    },
  },
};

export default config;
