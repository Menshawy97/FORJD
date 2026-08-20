import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:forjd/core/network/api_failure.dart';
import 'package:forjd/core/network/dio_client.dart';
import 'package:forjd/features/auth/application/auth_controller.dart';
import 'package:forjd/features/auth/data/secure_token_store.dart';
import 'package:forjd/features/auth/domain/auth_state.dart';

import '../../core/network/fakes.dart';

const _session = {
  'accessToken': 'access-1',
  'refreshToken': 'refresh-1',
  'expiresAt': '2026-06-01T12:00:00.000Z',
};

const _me = {
  'id': 'user-1',
  'email': 'ada@example.com',
  'profile': {
    'userId': 'user-1',
    'displayName': 'Ada Lovelace',
    'dateOfBirth': null,
    'sex': null,
    'heightCm': null,
    'unitSystem': 'metric',
    'avatarUrl': null,
  },
};

/// A device that already holds a complete, valid session. Copied with Map.of at each use:
/// a const map is unmodifiable, and the store deletes keys on sign-out.
const _signedInDevice = {
  'forjd.access_token': 'access-1',
  'forjd.refresh_token': 'refresh-1',
  'forjd.expires_at': '2026-06-01T12:00:00.000Z',
  'forjd.user_id': 'user-1',
  'forjd.email': 'ada@example.com',
};

Dio _dioWith(FakeHttpAdapter adapter) =>
    Dio(BaseOptions(baseUrl: 'https://example.test/api/v1'))
      ..httpClientAdapter = adapter;

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  /// A container whose public and api clients answer from the given handlers, over the real
  /// SecureTokenStore backed by mocked platform values — so the actual key names are
  /// exercised rather than a parallel fake that could drift from them.
  ProviderContainer harness({
    required ResponseBody Function(RequestOptions options) onPublic,
    ResponseBody Function(RequestOptions options)? onApi,
  }) {
    final container = ProviderContainer(
      overrides: [
        publicDioProvider.overrideWith(
          (ref) => _dioWith(FakeHttpAdapter((options, _) => onPublic(options))),
        ),
        apiDioProvider.overrideWith(
          (ref) => _dioWith(
            FakeHttpAdapter(
              (options, _) => (onApi ?? (_) => jsonBody(200, _me))(options),
            ),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    return container;
  }

  /// Reads the controller and lets its bootstrap microtask settle.
  Future<AuthState> settled(ProviderContainer container) async {
    container.read(authControllerProvider);
    await Future<void>.delayed(Duration.zero);

    return container.read(authControllerProvider);
  }

  group('bootstrap', () {
    test('with nothing stored, resolves to signed out', () async {
      final container = harness(onPublic: (_) => jsonBody(200, {}));

      expect(await settled(container), isA<AuthUnauthenticated>());
    });

    test(
      'with a stored session, resolves to signed in with no network call',
      () async {
        FlutterSecureStorage.setMockInitialValues(Map.of(_signedInDevice));

        final container = harness(
          onPublic: (_) =>
              throw StateError('a warm start must not hit the network'),
        );

        final state = await settled(container);

        expect(state, isA<AuthAuthenticated>());
        expect((state as AuthAuthenticated).email, 'ada@example.com');
      },
    );

    test('a half-written session is treated as signed out', () async {
      // Tokens present, identity missing — the state a device is left in if a write was
      // interrupted. Trusting it would mean rendering a session that cannot be used.
      FlutterSecureStorage.setMockInitialValues({
        'forjd.access_token': 'access-1',
        'forjd.refresh_token': 'refresh-1',
        'forjd.expires_at': '2026-06-01T12:00:00.000Z',
      });

      final container = harness(onPublic: (_) => jsonBody(200, {}));

      expect(await settled(container), isA<AuthUnauthenticated>());
    });
  });

  group('login', () {
    test('stores the session and identity, then reports signed in', () async {
      final container = harness(onPublic: (_) => jsonBody(200, _session));
      await settled(container);

      await container
          .read(authControllerProvider.notifier)
          .login(email: 'ada@example.com', password: 'password123');

      final state = container.read(authControllerProvider);
      expect(state, isA<AuthAuthenticated>());
      expect((state as AuthAuthenticated).userId, 'user-1');

      final stored = await container.read(secureTokenStoreProvider).read();
      expect(stored?.accessToken, 'access-1');
    });

    test(
      'a 401 leaves the user signed out with a renderable message',
      () async {
        final container = harness(
          onPublic: (_) => jsonBody(401, {'message': 'Invalid credentials'}),
        );
        await settled(container);

        await container
            .read(authControllerProvider.notifier)
            .login(email: 'ada@example.com', password: 'wrong');

        final state = container.read(authControllerProvider);
        expect(state, isA<AuthUnauthenticated>());
        expect(
          (state as AuthUnauthenticated).failure?.message,
          'Invalid credentials',
        );
      },
    );

    test(
      'clears the partial session when /users/me fails after login',
      () async {
        final container = harness(
          onPublic: (_) => jsonBody(200, _session),
          onApi: (_) => jsonBody(500, {}),
        );
        await settled(container);

        await container
            .read(authControllerProvider.notifier)
            .login(email: 'ada@example.com', password: 'password123');

        expect(
          container.read(authControllerProvider),
          isA<AuthUnauthenticated>(),
        );
        expect(
          await container.read(secureTokenStoreProvider).read(),
          isNull,
          reason: 'signed-out state and stored tokens must not disagree',
        );
      },
    );
  });

  group('register', () {
    test('a null session means awaiting confirmation, not failure', () async {
      final container = harness(
        onPublic: (_) => jsonBody(201, {
          'userId': 'user-1',
          'email': 'ada@example.com',
          'emailVerified': false,
          'session': null,
        }),
      );
      await settled(container);

      await container
          .read(authControllerProvider.notifier)
          .register(
            email: 'ada@example.com',
            password: 'password123',
            displayName: 'Ada Lovelace',
          );

      final state = container.read(authControllerProvider);
      expect(state, isA<AuthNeedsEmailConfirmation>());
      expect((state as AuthNeedsEmailConfirmation).email, 'ada@example.com');
    });

    test('a session issued immediately signs the user straight in', () async {
      final container = harness(
        onPublic: (_) => jsonBody(201, {
          'userId': 'user-1',
          'email': 'ada@example.com',
          'emailVerified': true,
          'session': _session,
        }),
      );
      await settled(container);

      await container
          .read(authControllerProvider.notifier)
          .register(email: 'ada@example.com', password: 'password123');

      expect(container.read(authControllerProvider), isA<AuthAuthenticated>());
    });

    test('omits displayName from the body when none was given', () async {
      final bodies = <Object?>[];
      final container = harness(
        onPublic: (options) {
          bodies.add(options.data);

          return jsonBody(201, {
            'userId': 'user-1',
            'email': 'ada@example.com',
            'emailVerified': false,
            'session': null,
          });
        },
      );
      await settled(container);

      await container
          .read(authControllerProvider.notifier)
          .register(email: 'ada@example.com', password: 'password123');

      expect((bodies.single! as Map).containsKey('displayName'), isFalse);
    });
  });

  group('sign out', () {
    test('logout clears the store even when revocation fails', () async {
      FlutterSecureStorage.setMockInitialValues(Map.of(_signedInDevice));

      final container = harness(
        onPublic: (_) => jsonBody(200, {}),
        onApi: (_) => jsonBody(500, {}),
      );
      await settled(container);

      await container.read(authControllerProvider.notifier).logout();

      expect(
        container.read(authControllerProvider),
        isA<AuthUnauthenticated>(),
      );
      expect(await container.read(secureTokenStoreProvider).read(), isNull);
    });

    test(
      'onSessionLost says why the user is back at the welcome screen',
      () async {
        FlutterSecureStorage.setMockInitialValues(Map.of(_signedInDevice));

        final container = harness(onPublic: (_) => jsonBody(200, {}));
        await settled(container);

        container.read(authControllerProvider.notifier).onSessionLost();

        final state = container.read(authControllerProvider);
        expect(state, isA<AuthUnauthenticated>());
        expect(
          (state as AuthUnauthenticated).failure?.message,
          contains('expired'),
        );
      },
    );
  });

  group('auth gate', () {
    test('collapses states so a failed login does not churn the router', () {
      expect(const AuthUnknown().gate, AuthGate.unknown);
      expect(const AuthAuthenticating().gate, AuthGate.signedOut);
      expect(const AuthUnauthenticated().gate, AuthGate.signedOut);
      expect(
        const AuthUnauthenticated(failure: ApiFailure('nope')).gate,
        AuthGate.signedOut,
      );
      expect(
        const AuthAuthenticated(userId: 'u', email: 'e').gate,
        AuthGate.signedIn,
      );
      expect(
        const AuthNeedsEmailConfirmation(email: 'e').gate,
        AuthGate.awaitingConfirmation,
      );
    });
  });
}
