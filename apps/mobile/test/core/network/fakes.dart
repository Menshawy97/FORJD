import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';

import 'package:forjd/core/network/session_ports.dart';

AuthTokens tokens(String access, {String refresh = 'refresh-1'}) => AuthTokens(
  accessToken: access,
  refreshToken: refresh,
  expiresAt: DateTime.utc(2026, 6, 1, 12),
);

/// An in-memory [TokenStore] that records how it was used.
class FakeTokenStore implements TokenStore {
  FakeTokenStore([this._tokens]);

  AuthTokens? _tokens;
  int clears = 0;
  int writes = 0;

  @override
  Future<AuthTokens?> read() async => _tokens;

  @override
  Future<void> write(AuthTokens value) async {
    writes++;
    _tokens = value;
  }

  @override
  Future<void> clear() async {
    clears++;
    _tokens = null;
  }
}

/// Counts refreshes, so a test can assert that N concurrent 401s produced exactly one.
class FakeRefresher implements TokenRefresher {
  FakeRefresher({this.issue = 'access-2', this.fails = false, this.delay});

  final String issue;
  final bool fails;
  final Duration? delay;
  int calls = 0;

  @override
  Future<AuthTokens> refresh(String refreshToken) async {
    calls++;

    if (delay != null) {
      await Future<void>.delayed(delay!);
    }

    if (fails) {
      throw DioException(
        requestOptions: RequestOptions(path: '/auth/refresh'),
        response: Response<dynamic>(
          requestOptions: RequestOptions(path: '/auth/refresh'),
          statusCode: 401,
        ),
      );
    }

    return tokens(issue, refresh: 'refresh-2');
  }
}

/// Answers requests from a routing table, so tests control status codes per attempt
/// without a real socket. Hand-written rather than a mock package because the concurrency
/// test needs to count calls and delay one response deterministically.
class FakeHttpAdapter implements HttpClientAdapter {
  FakeHttpAdapter(this.handler);

  /// Receives the request and the 1-based attempt count for that path.
  final ResponseBody Function(RequestOptions options, int attempt) handler;

  final List<RequestOptions> requests = [];
  final Map<String, int> _attempts = {};

  int attemptsFor(String path) => _attempts[path] ?? 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8ListOrString>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final attempt = (_attempts[options.path] ?? 0) + 1;
    _attempts[options.path] = attempt;

    return handler(options, attempt);
  }

  @override
  void close({bool force = false}) {}
}

typedef Uint8ListOrString = List<int>;

/// Simulates a transport failure — a dropped connection or a timeout — as opposed to a
/// server that answered with an error status. The distinction matters: one says nothing
/// about whether the session is valid, the other can.
Never throwNetworkError(RequestOptions options) {
  throw DioException(
    requestOptions: options,
    type: DioExceptionType.connectionError,
    error: 'simulated connection drop',
  );
}

ResponseBody jsonBody(int status, Map<String, dynamic> body) =>
    ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
