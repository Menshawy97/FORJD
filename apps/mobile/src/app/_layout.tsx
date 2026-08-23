import '../global.css';

// Theme primitives come from @react-navigation/native, not expo-router: expo-router@6 (the
// SDK 54 line — see ADR-013) does not re-export ThemeProvider/DarkTheme/DefaultTheme the way
// later versions do. `Redirect` does still come from expo-router (via its link/Link barrel).
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Redirect, Stack, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getCachedHasSession, hasSession, subscribeToSession } from '@/auth/secureStorage';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

/**
 * Exported so the scene background is assertable — it is the one screen option whose absence
 * is invisible until a transition is actually running on a device.
 *
 * react-navigation paints this behind and *between* screens during a push or pop. Left
 * unset it comes from the theme, which is why the light-theme branch below had to go: on a
 * light-mode phone the scene was white and every navigation flashed. Naming it removes the
 * dependency on the theme altogether.
 */
export const stackScreenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: colors.screenBg },
} as const;

/**
 * Auth state feeds the redirect decision through `useSyncExternalStore` over
 * `secureStorage`'s tiny notify-on-change subscription — the RN equivalent of ADR-011's
 * `refreshListenable`. This is deliberately not the same thing the ADR warns against
 * (`ref.watch` tearing down the whole `GoRouter`): the `Stack` below is never recreated:
 * only `AuthGate`'s own render re-evaluates when a sign-in/sign-out notifies. The initial
 * keystore read still happens exactly once, in the effect below, not on every render.
 */
export default function RootLayout() {
  // Archivo is a variable font (weight moves through the `wght` axis rather than shipping a
  // file per weight) — see 02-design-tokens.md's Typography section and ADR-010. Bundled
  // locally, no network fetch, same reasoning as the Flutter build.
  const [fontsLoaded] = useFonts({
    Archivo: require('../../assets/fonts/Archivo-Variable.ttf'),
  });
  const [authChecked, setAuthChecked] = useState(false);
  const authenticated = useSyncExternalStore(subscribeToSession, getCachedHasSession, getCachedHasSession);

  useEffect(() => {
    let cancelled = false;
    // `authChecked` gates *all* UI — while it is false this component returns null and the
    // splash screen stays up. So a rejected keystore read (locked device, corrupted keychain
    // entry, SecureStore platform error) must not be allowed to leave it false: that is not
    // a failed sign-in, it is a permanently blank screen with no path out, plus an unhandled
    // rejection. An unreadable keystore is treated as "no session" — the user lands on
    // /welcome and can log in, which is somewhere they can act. The cached-session read that
    // drives the redirect is a separate, synchronous path and is already false here.
    const markChecked = () => {
      if (!cancelled) {
        setAuthChecked(true);
      }
    };
    hasSession().then(markChecked, markChecked);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (fontsLoaded && authChecked) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, authChecked]);

  if (!fontsLoaded || !authChecked) {
    return null;
  }

  return (
    // `DarkTheme` unconditionally, not `colorScheme === 'dark' ? … : DefaultTheme`. There is
    // no light variant of this design anywhere — one palette in 02-design-tokens.md, every
    // screen on #101011 — so following the device's setting could only ever produce a
    // half-light app, never a designed one. app.config.ts says `userInterfaceStyle: 'dark'`
    // for the same reason, which is what stops the OS drawing light chrome around us.
    // `SafeAreaProvider` at the very top so every screen's `useSafeAreaInsets()` reads one
    // shared measurement. react-navigation mounts its own compatibility provider further
    // down, but that one only covers what is inside a navigator — screens are not the only
    // thing that needs the inset, and relying on it would make the value depend on where in
    // the tree a component happens to sit.
    <SafeAreaProvider>
      <ThemeProvider value={DarkTheme}>
        <StatusBar style="light" />
        <Stack screenOptions={stackScreenOptions} />
        {!authenticated && <AuthGate />}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * The three routes reachable with no session: the ones that exist to *get* one. Every other
 * top-level route requires auth — including ones outside the `(tabs)` group, like
 * `editProfile`/`units` (slice 2) and whatever else lands beside them later
 * (`goals`/`notifs`/`privacy`/`location`/`athlete`).
 *
 * This is an allowlist rather than a denylist on purpose: the previous version denylisted
 * exactly one thing (`(tabs)`), so a new top-level authenticated screen was invisible to it
 * by construction — nobody had to forget to update this file, there was nothing to update.
 * An allowlist fails the other direction instead: a new *public* route that forgets to be
 * added here is over-protected (redirected when it should not be), which surfaces
 * immediately as a broken screen rather than silently as reachable-while-signed-out.
 */
const PUBLIC_ROUTES = new Set(['welcome', 'login', 'signup']);

/** Redirects to /welcome for any authenticated route when there is no session. Separated
 * from RootLayout so the `useSegments` read (and the resulting extra render on route
 * changes) is scoped to this tiny component rather than the whole layout tree. */
function AuthGate() {
  const segments = useSegments();
  // Cast to string: the typed-routes union for useSegments() is generated from the app's
  // route tree and does not reliably include every segment name — this check is a runtime
  // string comparison regardless of what TS infers here.
  const firstSegment = segments[0] as string | undefined;

  // No segment yet is the transient pre-resolution state, not a route decision — treated as
  // "not public" would redirect before any real route has even resolved. RootLayout's own
  // `authChecked`/`fontsLoaded` gate keeps this from being reachable in practice; kept
  // conservative here anyway rather than relying on that alone.
  if (firstSegment === undefined || PUBLIC_ROUTES.has(firstSegment)) {
    return null;
  }

  return <Redirect href="/welcome" />;
}
