import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:forjd/core/network/api_failure.dart';
import 'package:forjd/features/auth/data/auth_repository.dart';
import 'package:forjd/features/auth/data/secure_token_store.dart';
import 'package:forjd/features/auth/domain/auth_state.dart';

/// Owns the session: what it is, and every transition that changes it.
///
/// A plain [Notifier] over a sealed state rather than an [AsyncNotifier]. `AsyncNotifier`
/// would wrap this in an `AsyncValue`, giving two overlapping notions of "loading" that the
/// router's redirect would then have to unpick; the sealed state already models each case
/// exactly once.
class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    // Starts unknown and resolves out of band. Anything else would either block the first
    // frame on a keystore read or flash the welcome screen at an already-signed-in user.
    Future.microtask(restore);

    return const AuthUnknown();
  }

  AuthRepository get _repository => ref.read(authRepositoryProvider);
  SecureTokenStore get _store => ref.read(secureTokenStoreProvider);

  /// Resolves [AuthUnknown] into a real state from what is on the device.
  Future<void> restore() async {
    final tokens = await _store.read();
    final identity = tokens == null ? null : await _store.readIdentity();

    if (tokens == null || identity == null) {
      state = const AuthUnauthenticated();
      return;
    }

    // Optimistic: trust the stored identity so a warm start goes straight to the app. If
    // the session is actually dead, the first authenticated request 401s, the interceptor
    // fails to refresh, and onSessionLost corrects this.
    state = AuthAuthenticated(userId: identity.userId, email: identity.email);
  }

  Future<void> login({required String email, required String password}) async {
    state = const AuthAuthenticating();

    try {
      final session = await _repository.login(email: email, password: password);
      await _store.write(session.toTokens());

      final me = await _repository.fetchMe();
      await _store.writeIdentity(
        StoredIdentity(userId: me.id, email: me.email),
      );

      state = AuthAuthenticated(userId: me.id, email: me.email);
    } on ApiFailure catch (failure) {
      // The tokens may have been written before /users/me failed. Clearing keeps "signed
      // out" and "has tokens" from disagreeing.
      await _store.clear();
      state = AuthUnauthenticated(failure: failure);
    }
  }

  Future<void> register({
    required String email,
    required String password,
    String? displayName,
  }) async {
    state = const AuthAuthenticating();

    try {
      final result = await _repository.register(
        email: email,
        password: password,
        displayName: displayName,
      );

      final session = result.session;

      // No session is a success, not a failure: the account exists and is waiting on the
      // confirmation link. This is what forjd-dev returns today.
      if (session == null) {
        state = AuthNeedsEmailConfirmation(email: result.email);
        return;
      }

      await _store.write(session.toTokens());
      await _store.writeIdentity(
        StoredIdentity(userId: result.userId, email: result.email),
      );

      state = AuthAuthenticated(userId: result.userId, email: result.email);
    } on ApiFailure catch (failure) {
      await _store.clear();
      state = AuthUnauthenticated(failure: failure);
    }
  }

  /// Best-effort revocation, then local sign-out regardless.
  ///
  /// A network failure must not strand someone in a session they asked to leave, so the
  /// local clear happens either way — but revocation is attempted first so the refresh
  /// token is genuinely dead in the common case.
  Future<void> logout() async {
    try {
      await _repository.logout();
    } on ApiFailure {
      // Deliberately swallowed. See above.
    }

    await _store.clear();
    state = const AuthUnauthenticated();
  }

  /// Returns the failure rather than storing it: this does not change the session, and
  /// putting it in [AuthUnauthenticated] would leak a reset error onto the login screen.
  Future<ApiFailure?> requestPasswordReset(String email) async {
    try {
      await _repository.requestPasswordReset(email);
      return null;
    } on ApiFailure catch (failure) {
      return failure;
    }
  }

  /// Called by the interceptor when a refresh has failed and the session is gone.
  ///
  /// The store is already cleared by then; this only moves the app's state, which the
  /// router observes and acts on.
  void onSessionLost() {
    if (state is! AuthUnauthenticated) {
      state = const AuthUnauthenticated(
        failure: ApiFailure('Your session expired. Please log in again.'),
      );
    }
  }

  /// Clears a stale error so returning to a form does not show the last attempt's message.
  void clearFailure() {
    if (state case AuthUnauthenticated(failure: final failure)
        when failure != null) {
      state = const AuthUnauthenticated();
    }
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);
