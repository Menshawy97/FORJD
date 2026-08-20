import 'package:dio/dio.dart';
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:forjd/app/app.dart';
import 'package:forjd/core/network/dio_client.dart';
import 'package:forjd/data/local/database.dart';
import 'package:forjd/features/auth/data/secure_token_store.dart';

import '../../core/network/fakes.dart';

/// End-to-end journeys through the real screens, the real router and the real controllers.
///
/// Only the HTTP transport and the platform keystore are faked, so these exercise the
/// wiring the unit tests deliberately isolate: redirects, form submission, state
/// transitions, and what a person actually sees at each step.

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

const _signedInDevice = {
  'forjd.access_token': 'access-1',
  'forjd.refresh_token': 'refresh-1',
  'forjd.expires_at': '2026-06-01T12:00:00.000Z',
  'forjd.user_id': 'user-1',
  'forjd.email': 'ada@example.com',
};

void main() {
  late AppDatabase database;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    database = AppDatabase(NativeDatabase.memory());
  });

  tearDown(() => database.close());

  /// Boots the whole app against scripted endpoints.
  Future<ProviderContainer> boot(
    WidgetTester tester,
    ResponseBody Function(RequestOptions options) handler,
  ) async {
    Dio client() => Dio(BaseOptions(baseUrl: 'https://example.test/api/v1'))
      ..httpClientAdapter = FakeHttpAdapter((options, _) => handler(options));

    final container = ProviderContainer(
      overrides: [
        appDatabaseProvider.overrideWithValue(database),
        publicDioProvider.overrideWith((ref) => client()),
        apiDioProvider.overrideWith((ref) => client()),
        refreshDioProvider.overrideWith((ref) => client()),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(container: container, child: const ForjdApp()),
    );
    await tester.pumpAndSettle();

    return container;
  }

  ResponseBody happyPath(RequestOptions options) => switch (options.path) {
    '/auth/login' => jsonBody(200, _session),
    '/users/me' => jsonBody(200, _me),
    '/auth/logout' => jsonBody(204, {}),
    _ => jsonBody(404, {'message': 'unexpected ${options.path}'}),
  };

  testWidgets('log in from the welcome screen, land in the app, then log out', (
    tester,
  ) async {
    final container = await boot(tester, happyPath);

    expect(find.text('Training.\nRecovery.\nProgress.'), findsOneWidget);

    await tester.tap(find.text('Log In'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'ada@example.com');
    await tester.enterText(find.byType(TextField).last, 'Str0ng!Pass');
    await tester.tap(find.widgetWithText(InkWell, 'Log In').last);
    await tester.pumpAndSettle();

    // Signed in: the shell and its tabs are on screen.
    expect(find.text('Rank'), findsOneWidget);
    expect(
      await container.read(secureTokenStoreProvider).read(),
      isNotNull,
      reason: 'the session must be persisted, not just held in memory',
    );

    await tester.tap(find.text('Profile'));
    await tester.pumpAndSettle();
    expect(find.text('Ada Lovelace'), findsOneWidget);
    expect(
      find.text('ada@example.com'),
      findsOneWidget,
      reason: 'the email stands in for the handle the design shows',
    );

    // Log out sits below the settings rows, off-screen at the test viewport's height.
    await tester.dragUntilVisible(
      find.text('Log out'),
      find.byType(ListView),
      const Offset(0, -120),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Log out'));
    await tester.pumpAndSettle();

    expect(find.text('Create Account'), findsOneWidget);
    expect(
      await container.read(secureTokenStoreProvider).read(),
      isNull,
      reason: 'logging out must clear the device, not only the screen',
    );
  });

  testWidgets('bad credentials keep the user on the form with a message', (
    tester,
  ) async {
    await boot(
      tester,
      (options) => options.path == '/auth/login'
          ? jsonBody(401, {'message': 'Invalid credentials'})
          : jsonBody(404, {}),
    );

    await tester.tap(find.text('Log In'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, 'ada@example.com');
    await tester.enterText(find.byType(TextField).last, 'wrong');
    await tester.tap(find.widgetWithText(InkWell, 'Log In').last);
    await tester.pumpAndSettle();

    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Invalid credentials'), findsOneWidget);
  });

  testWidgets('registering without a session shows the confirm-email panel', (
    tester,
  ) async {
    await boot(
      tester,
      (options) => options.path == '/auth/register'
          ? jsonBody(201, {
              'userId': 'user-1',
              'email': 'ada@example.com',
              'emailVerified': false,
              'session': null,
            })
          : jsonBody(404, {}),
    );

    await tester.tap(find.text('Create Account'));
    await tester.pumpAndSettle();
    expect(find.text('Create account'), findsOneWidget);

    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), 'Ada Lovelace');
    await tester.enterText(fields.at(1), 'ada@example.com');
    await tester.enterText(fields.at(2), 'Str0ng!Pass');
    await tester.tap(find.widgetWithText(InkWell, 'Create Account').last);
    await tester.pumpAndSettle();

    // A registration that issues no session is a success, not a failure.
    expect(find.text('Check your inbox'), findsOneWidget);
    expect(find.textContaining('ada@example.com'), findsOneWidget);

    // And the user can get out of it — the router pins this state to /register, so leaving
    // only works because the screen dismisses that state first.
    await tester.tap(find.text('Back to log in'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);
  });

  testWidgets('a rejected password says why, under the password field', (
    tester,
  ) async {
    // The point of surfacing policy failures at all: a generic "Registration failed" would
    // leave someone at a form with no idea what to change.
    await boot(
      tester,
      (options) => options.path == '/auth/register'
          ? jsonBody(400, {
              'message': 'Validation failed',
              'errors': {
                'password': ['Password must include an uppercase letter'],
              },
            })
          : jsonBody(404, {}),
    );

    await tester.tap(find.text('Create Account'));
    await tester.pumpAndSettle();

    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), 'Ada Lovelace');
    await tester.enterText(fields.at(1), 'ada@example.com');
    await tester.enterText(fields.at(2), 'password123');
    await tester.tap(find.widgetWithText(InkWell, 'Create Account').last);
    await tester.pumpAndSettle();

    expect(
      find.text('Password must include an uppercase letter'),
      findsOneWidget,
    );
    expect(
      find.text('Validation failed'),
      findsNothing,
      reason:
          'the summary line would only repeat the field message less usefully',
    );
    expect(
      find.text('Create account'),
      findsOneWidget,
      reason: 'the user stays on the form so they can fix it',
    );
  });

  testWidgets('an empty register form is rejected before any network call', (
    tester,
  ) async {
    var requests = 0;
    await boot(tester, (options) {
      requests++;

      return jsonBody(404, {});
    });

    await tester.tap(find.text('Create Account'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(InkWell, 'Create Account').last);
    await tester.pumpAndSettle();

    expect(find.text('All fields are required.'), findsOneWidget);
    expect(requests, 0, reason: 'nothing to send, so nothing should be sent');
  });

  testWidgets('a stored session skips the welcome screen entirely', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues(Map.of(_signedInDevice));

    await boot(tester, happyPath);

    // AuthUnknown doing its job: a warm start lands in the app with no flash of the
    // signed-out screen.
    expect(find.text('Create Account'), findsNothing);
    expect(find.text('Rank'), findsOneWidget);
  });

  testWidgets('requesting a password reset ends in the same panel either way', (
    tester,
  ) async {
    await boot(
      tester,
      (options) => options.path == '/auth/forgot-password'
          ? jsonBody(202, {})
          : jsonBody(404, {}),
    );

    await tester.tap(find.text('Log In'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Forgot password?'));
    await tester.pumpAndSettle();

    expect(find.text('Reset password'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'nobody@example.com');
    await tester.tap(find.widgetWithText(InkWell, 'Send reset link').last);
    await tester.pumpAndSettle();

    // Deliberately "if ... has an account": the API answers identically whether or not it
    // does, and the screen must not imply otherwise.
    expect(find.text('Check your email'), findsOneWidget);
    expect(
      find.textContaining('If nobody@example.com has an account'),
      findsOneWidget,
    );
  });
}
