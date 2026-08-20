import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A session as the network layer needs to see it.
///
/// Deliberately not the auth feature's DTO: `core/network` must not import `features/`,
/// or the interceptor could not be tested without dragging in the whole auth stack.
class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime expiresAt;
}

/// Where session tokens live. Implemented over secure storage by the auth feature.
abstract interface class TokenStore {
  Future<AuthTokens?> read();
  Future<void> write(AuthTokens tokens);
  Future<void> clear();
}

/// Exchanges a refresh token for a new session. Throws if the refresh is rejected.
abstract interface class TokenRefresher {
  Future<AuthTokens> refresh(String refreshToken);
}

/// The ports below are bound in main.dart, the one place allowed to know both `core` and
/// `features`. They throw rather than returning a no-op default so a missing override fails
/// loudly at startup instead of silently signing every request as anonymous.
final tokenStoreProvider = Provider<TokenStore>(
  (ref) => throw UnimplementedError(
    'tokenStoreProvider must be overridden in main.dart',
  ),
);

final tokenRefresherProvider = Provider<TokenRefresher>(
  (ref) => throw UnimplementedError(
    'tokenRefresherProvider must be overridden in main.dart',
  ),
);

/// Called when a refresh fails and the session is gone for good. Defaults to a no-op
/// because "nobody is listening" is a coherent state — the router simply will not redirect.
final sessionLostProvider = Provider<void Function()>((ref) => () {});
