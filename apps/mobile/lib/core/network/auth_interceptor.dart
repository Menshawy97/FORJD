import 'package:dio/dio.dart';

import 'package:forjd/core/network/session_ports.dart';

/// Signs outgoing requests, and on a 401 refreshes the session once and replays the
/// request.
///
/// It never navigates. A failed refresh clears the store and reports it through the
/// session-lost callback; deciding what the user sees is the router's job.
class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor({
    required this.store,
    required this.refresher,
    required this.onSessionLost,
    required this.retryClient,
  });

  final TokenStore store;
  final TokenRefresher refresher;
  final void Function() onSessionLost;

  /// Must not carry this interceptor. See apiDioProvider for why that would deadlock.
  final Dio retryClient;

  /// Marks a request that has already been replayed once.
  static const retriedKey = 'forjd.retried';

  /// Paths whose own 401 means "these credentials are wrong", not "this session expired".
  static const _unauthenticatedPaths = {
    '/auth/login',
    '/auth/register',
    '/auth/refresh',
    '/auth/forgot-password',
  };

  /// The in-flight refresh, shared by every request that hits a 401 while it runs. Holding
  /// the future rather than a lock is what collapses N concurrent 401s into one network
  /// call: every caller awaits this same future.
  Future<AuthTokens>? _inFlight;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    if (!options.headers.containsKey('Authorization')) {
      final tokens = await store.read();

      if (tokens != null) {
        options.headers['Authorization'] = 'Bearer ${tokens.accessToken}';
      }
    }

    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    if (!_shouldAttemptRefresh(err)) {
      return handler.next(err);
    }

    final stale = await store.read();

    if (stale == null) {
      return handler.next(err);
    }

    final AuthTokens tokens;

    try {
      // Another request may already have refreshed while this one was in flight. If the
      // stored token has moved on from the one this request sent, there is nothing to
      // refresh — just replay with what is current.
      final sent = err.requestOptions.headers['Authorization'];
      tokens = sent == 'Bearer ${stale.accessToken}'
          ? await _refreshOnce(stale.refreshToken)
          : stale;
    } on Object {
      // The refresh itself failed, so the session cannot be renewed. This is the only
      // place that is true.
      await _endSession();

      // The original error, not the refresh error: the caller asked for a profile, and
      // "your profile request failed" is the true thing to tell them.
      return handler.next(err);
    }

    try {
      handler.resolve(await _replay(err.requestOptions, tokens));
    } on DioException catch (replayError) {
      // The replay is deliberately outside the block above. A dropped connection or a
      // timeout here says nothing about whether the session is valid, and tearing it down
      // for one would log a user out over a moment of bad signal — with a token that had
      // just been refreshed successfully.
      //
      // A 401 is the exception: the token the server just issued was rejected, so the
      // session really is gone.
      if (replayError.response?.statusCode == 401) {
        await _endSession();
      }

      handler.next(err);
    } on Object {
      handler.next(err);
    }
  }

  Future<void> _endSession() async {
    await store.clear();
    onSessionLost();
  }

  bool _shouldAttemptRefresh(DioException err) {
    if (err.response?.statusCode != 401) {
      return false;
    }

    if (err.requestOptions.extra[retriedKey] == true) {
      return false;
    }

    return !_unauthenticatedPaths.any(err.requestOptions.path.endsWith);
  }

  Future<AuthTokens> _refreshOnce(String refreshToken) {
    // `??=` must stay the only assignment site — a second one would let two refreshes race
    // and one of them rotate a token the other is about to use.
    return _inFlight ??= refresher
        .refresh(refreshToken)
        .then((tokens) async {
          await store.write(tokens);
          return tokens;
        })
        .whenComplete(() => _inFlight = null);
  }

  Future<Response<dynamic>> _replay(RequestOptions options, AuthTokens tokens) {
    return retryClient.fetch<dynamic>(
      options.copyWith(
        headers: {
          ...options.headers,
          'Authorization': 'Bearer ${tokens.accessToken}',
        },
        extra: {...options.extra, retriedKey: true},
      ),
    );
  }
}
