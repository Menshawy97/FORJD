import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:forjd/core/network/auth_interceptor.dart';
import 'package:forjd/core/network/session_ports.dart';

/// Compile-time so no URL is baked into a build by accident:
/// `--dart-define=API_BASE_URL=https://...`. The default is the Android emulator's route to
/// the host machine.
const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2:3000/api/v1',
);

BaseOptions _baseOptions() => BaseOptions(
  baseUrl: apiBaseUrl,
  connectTimeout: const Duration(seconds: 10),
  receiveTimeout: const Duration(seconds: 10),
);

/// Unauthenticated endpoints: register, login, forgot-password.
final publicDioProvider = Provider<Dio>((ref) => Dio(_baseOptions()));

/// `POST /auth/refresh` and nothing else.
///
/// A separate client is the structural guarantee against recursion: the refresh call
/// physically cannot re-enter [AuthInterceptor], so a 401 from the refresh endpoint can
/// never trigger another refresh. Skipping by path would work too, but that is a convention
/// someone can break later; a separate client cannot be broken by accident.
final refreshDioProvider = Provider<Dio>((ref) => Dio(_baseOptions()));

/// Everything that needs a signed request. Attaches the bearer token and handles the
/// 401 → refresh → replay cycle.
final apiDioProvider = Provider<Dio>((ref) {
  final dio = Dio(_baseOptions());

  dio.interceptors.add(
    AuthInterceptor(
      store: ref.watch(tokenStoreProvider),
      refresher: ref.watch(tokenRefresherProvider),
      onSessionLost: ref.watch(sessionLostProvider),
      // A client with no interceptor, for the same reason refreshDio is separate — and
      // here it is load-bearing rather than defensive. QueuedInterceptor serialises its
      // callbacks, so a replay sent back through `dio` would queue behind the very onError
      // that is awaiting it, and the request would hang until it timed out. The replay
      // already carries its Authorization header and is marked as retried, so it needs
      // nothing the interceptor provides.
      retryClient: Dio(_baseOptions()),
    ),
  );

  return dio;
});
