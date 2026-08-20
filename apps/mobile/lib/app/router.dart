import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:forjd/features/auth/application/auth_controller.dart';
import 'package:forjd/features/auth/domain/auth_state.dart';
import 'package:forjd/features/auth/presentation/forgot_password_screen.dart';
import 'package:forjd/features/auth/presentation/login_screen.dart';
import 'package:forjd/features/auth/presentation/register_screen.dart';
import 'package:forjd/features/auth/presentation/welcome_screen.dart';
import 'package:forjd/features/profile/presentation/edit_profile_screen.dart';
import 'package:forjd/features/profile/presentation/profile_screen.dart';
import 'package:forjd/features/shell/presentation/app_shell.dart';

/// Routes reachable without a session.
const _publicRoutes = {'/welcome', '/login', '/register', '/forgot-password'};

/// Notifies GoRouter that the auth gate moved.
///
/// This indirection is the whole reason the router survives a login. `app.dart` does
/// `routerConfig: ref.watch(routerProvider)`, so if [routerProvider] watched auth state
/// directly, every sign-in would build a *new* GoRouter and hand it to MaterialApp — tearing
/// down the navigation stack, dropping in-flight animations, and losing any pushed route.
/// The router is built once; only this listenable changes.
class GoRouterRefresh extends ChangeNotifier {
  void ping() => notifyListeners();
}

final _authRefreshProvider = Provider<GoRouterRefresh>((ref) {
  final notifier = GoRouterRefresh();

  ref.listen<AuthState>(authControllerProvider, (previous, next) {
    // Only when the gate itself moves. A failed login changes the state's failure message
    // but not the gate, and re-running every redirect for that would be noise.
    if (previous?.gate != next.gate) {
      notifier.ping();
    }
  }, fireImmediately: true);

  ref.onDispose(notifier.dispose);

  return notifier;
});

final routerProvider = Provider<GoRouter>((ref) {
  // Watched, not read: this subscription is what keeps AuthController alive. Read it once
  // and the controller could be disposed, leaving the gate silently stuck.
  final refresh = ref.watch(_authRefreshProvider);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      // `read`, never `watch`. This runs at redirect time, so it always sees current state
      // without making the router itself depend on it.
      final gate = ref.read(authControllerProvider).gate;
      final location = state.matchedLocation;

      return switch (gate) {
        // Still reading the keystore. Hold on the splash rather than guessing.
        AuthGate.unknown => location == '/splash' ? null : '/splash',
        // Registered but unconfirmed: pinned to the register screen, which shows the
        // "check your inbox" panel. Leaving requires dismissing that state explicitly.
        AuthGate.awaitingConfirmation =>
          location == '/register' ? null : '/register',
        // AuthAuthenticating collapses to signedOut, and /login is public, so someone
        // mid-submit stays put with a spinner instead of being bounced away from the form.
        AuthGate.signedOut =>
          _publicRoutes.contains(location) ? null : '/welcome',
        AuthGate.signedIn =>
          location == '/splash' || _publicRoutes.contains(location)
              ? '/home'
              : null,
      };
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/welcome', builder: (_, _) => const WelcomeScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/register', builder: (_, _) => const RegisterScreen()),
      GoRoute(
        path: '/forgot-password',
        builder: (_, _) => const ForgotPasswordScreen(),
      ),
      // Outside the shell so it covers the tab bar, matching the design's full-screen
      // chrome. Declared before the shell so the more specific path wins.
      GoRoute(
        path: '/profile/edit',
        builder: (_, _) => const EditProfileScreen(),
      ),
      // indexedStack, not a plain ShellRoute: a plain shell shares one Navigator, so
      // switching tabs would destroy the previous tab's scroll position and stack — the
      // exact thing a five-tab bar is expected to preserve.
      StatefulShellRoute.indexedStack(
        builder: (_, _, navigationShell) =>
            AppShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/home',
                builder: (_, _) => const PlaceholderTab(title: 'Home'),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/train',
                builder: (_, _) => const PlaceholderTab(title: 'Train'),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/progress',
                builder: (_, _) => const PlaceholderTab(title: 'Progress'),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/rank',
                builder: (_, _) => const PlaceholderTab(title: 'Rank'),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/profile',
                builder: (_, _) => const ProfileScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});
