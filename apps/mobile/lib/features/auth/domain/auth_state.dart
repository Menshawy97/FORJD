import 'package:forjd/core/network/api_failure.dart';

/// Everything the app can know about the current session.
///
/// Sealed so the router's redirect is an exhaustive switch: a new variant becomes a
/// compile error at every decision point rather than a route that silently falls through.
sealed class AuthState {
  const AuthState();

  /// What the router actually cares about. Collapsing to this means a failed login — which
  /// changes [AuthUnauthenticated.failure] but not the gate — does not churn the router.
  AuthGate get gate => switch (this) {
    AuthUnknown() => AuthGate.unknown,
    AuthUnauthenticated() || AuthAuthenticating() => AuthGate.signedOut,
    AuthAuthenticated() => AuthGate.signedIn,
    AuthNeedsEmailConfirmation() => AuthGate.awaitingConfirmation,
  };
}

enum AuthGate { unknown, signedOut, signedIn, awaitingConfirmation }

/// Reading stored tokens. The state the app starts in.
///
/// Without it, the first frame of a cold start would look signed-out and bounce a
/// logged-in user to the welcome screen before secure storage had answered.
final class AuthUnknown extends AuthState {
  const AuthUnknown();
}

final class AuthUnauthenticated extends AuthState {
  const AuthUnauthenticated({this.failure});

  /// Why the last attempt failed, if one did. Null on a clean sign-out.
  final ApiFailure? failure;
}

/// A sign-in or sign-up is in flight.
///
/// Deliberately carries no indication of *which*: the screen that started it already knows,
/// and this exists so the button's spinner and the router's "don't redirect yet" read the
/// same source of truth.
final class AuthAuthenticating extends AuthState {
  const AuthAuthenticating();
}

final class AuthAuthenticated extends AuthState {
  const AuthAuthenticated({required this.userId, required this.email});

  final String userId;
  final String email;
}

/// Registered, but the provider issued no session until the emailed link is clicked.
///
/// This is a legitimate outcome of a successful registration, not an error — it is what
/// `forjd-dev` returns today, because email confirmation is on.
final class AuthNeedsEmailConfirmation extends AuthState {
  const AuthNeedsEmailConfirmation({required this.email});

  final String email;
}
