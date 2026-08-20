import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:forjd/core/network/auth_interceptor.dart';

import 'fakes.dart';

void main() {
  late FakeTokenStore store;
  late FakeRefresher refresher;
  late Dio dio;
  var sessionLost = 0;

  /// Wires a Dio whose adapter 401s the first attempt at [failingPath] and 200s afterwards.
  FakeHttpAdapter arrange({
    String failingPath = '/users/me',
    int failTimes = 1,
    FakeRefresher? withRefresher,
    bool signedIn = true,
  }) {
    store = FakeTokenStore(signedIn ? tokens('access-1') : null);
    refresher = withRefresher ?? FakeRefresher();
    sessionLost = 0;

    final adapter = FakeHttpAdapter(
      (options, attempt) => options.path == failingPath && attempt <= failTimes
          ? jsonBody(401, {'message': 'Unauthorized'})
          : jsonBody(200, {
              'ok': true,
              'sentAuth': options.headers['Authorization'],
            }),
    );

    dio = Dio(BaseOptions(baseUrl: 'https://example.test/api/v1'))
      ..httpClientAdapter = adapter;
    // Mirrors apiDioProvider: replays use an interceptor-free client sharing the adapter.
    final replayClient = Dio(
      BaseOptions(baseUrl: 'https://example.test/api/v1'),
    )..httpClientAdapter = adapter;
    dio.interceptors.add(
      AuthInterceptor(
        store: store,
        refresher: refresher,
        onSessionLost: () => sessionLost++,
        retryClient: replayClient,
      ),
    );

    return adapter;
  }

  test('attaches the stored bearer token to an outgoing request', () async {
    final adapter = arrange(failTimes: 0);

    await dio.get<dynamic>('/users/me');

    expect(adapter.requests.single.headers['Authorization'], 'Bearer access-1');
  });

  test(
    'a 401 refreshes once and replays the request with the new token',
    () async {
      final adapter = arrange();

      final response = await dio.get<dynamic>('/users/me');

      expect(refresher.calls, 1);
      expect(store.writes, 1);
      expect(
        adapter.attemptsFor('/users/me'),
        2,
        reason: 'original attempt plus one replay',
      );
      expect(response.data['sentAuth'], 'Bearer access-2');
    },
  );

  test('three concurrent 401s trigger exactly one refresh', () async {
    arrange(
      withRefresher: FakeRefresher(delay: const Duration(milliseconds: 40)),
    );

    await Future.wait([
      dio.get<dynamic>('/users/me'),
      dio.get<dynamic>('/users/me'),
      dio.get<dynamic>('/users/me'),
    ]);

    expect(
      refresher.calls,
      1,
      reason: 'the in-flight future must be shared, not re-entered per request',
    );
  });

  test('a failed refresh clears the store, reports it, and rethrows the original error', () async {
    arrange(withRefresher: FakeRefresher(fails: true));

    await expectLater(
      dio.get<dynamic>('/users/me'),
      throwsA(
        isA<DioException>().having(
          (e) => e.requestOptions.path,
          'the original request, not the refresh',
          '/users/me',
        ),
      ),
    );

    expect(store.clears, 1);
    expect(sessionLost, 1);
  });

  test(
    'a dropped connection during the replay keeps the refreshed session',
    () async {
      // The regression this exists for: refresh succeeds and writes new tokens, then the
      // replay dies on the network. Tearing the session down here would log someone out
      // over a moment of bad signal, holding a token that had just been issued.
      store = FakeTokenStore(tokens('access-1'));
      refresher = FakeRefresher();
      sessionLost = 0;

      final adapter = FakeHttpAdapter(
        (options, attempt) => attempt == 1
            ? jsonBody(401, {'message': 'Unauthorized'})
            : throwNetworkError(options),
      );

      dio = Dio(BaseOptions(baseUrl: 'https://example.test/api/v1'))
        ..httpClientAdapter = adapter;
      final replayClient = Dio(
        BaseOptions(baseUrl: 'https://example.test/api/v1'),
      )..httpClientAdapter = adapter;
      dio.interceptors.add(
        AuthInterceptor(
          store: store,
          refresher: refresher,
          onSessionLost: () => sessionLost++,
          retryClient: replayClient,
        ),
      );

      await expectLater(
        dio.get<dynamic>('/users/me'),
        throwsA(isA<DioException>()),
      );

      expect(refresher.calls, 1);
      expect(store.clears, 0, reason: 'the refreshed session must survive');
      expect(sessionLost, 0);
      expect(
        (await store.read())?.accessToken,
        'access-2',
        reason: 'the newly refreshed token is still usable',
      );
    },
  );

  test('a 401 on the replay does end the session', () async {
    // The counterpart: the server rejected the token it had just issued, so the session
    // genuinely is gone and signing out is correct.
    arrange(failTimes: 99);

    await expectLater(
      dio.get<dynamic>('/users/me'),
      throwsA(isA<DioException>()),
    );

    expect(refresher.calls, 1);
    expect(store.clears, 1);
    expect(sessionLost, 1);
  });

  test(
    'a 401 from /auth/login is passed straight through without refreshing',
    () async {
      arrange(failingPath: '/auth/login', failTimes: 99);

      await expectLater(
        dio.post<dynamic>('/auth/login'),
        throwsA(isA<DioException>()),
      );

      expect(refresher.calls, 0);
      expect(sessionLost, 0);
    },
  );

  test('a request is never replayed twice', () async {
    final adapter = arrange(failTimes: 99);

    await expectLater(
      dio.get<dynamic>('/users/me'),
      throwsA(isA<DioException>()),
    );

    expect(refresher.calls, 1);
    expect(
      adapter.attemptsFor('/users/me'),
      2,
      reason: 'one replay, then give up',
    );
  });

  test('with no stored session a 401 is not treated as an expiry', () async {
    arrange(signedIn: false, failTimes: 99);

    await expectLater(
      dio.get<dynamic>('/users/me'),
      throwsA(isA<DioException>()),
    );

    expect(refresher.calls, 0);
  });
}
