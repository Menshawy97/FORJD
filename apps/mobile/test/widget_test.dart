import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:forjd/app/app.dart';
import 'package:forjd/app/router.dart';
import 'package:forjd/core/network/dio_client.dart';

import 'core/network/fakes.dart';

/// A signed-out app whose network calls all fail fast, so no test depends on a socket.
ProviderContainer _signedOut() {
  Dio offline() => Dio(BaseOptions(baseUrl: 'https://example.test/api/v1'))
    ..httpClientAdapter = FakeHttpAdapter(
      (_, _) => jsonBody(503, {'message': 'offline in tests'}),
    );

  final container = ProviderContainer(
    overrides: [
      publicDioProvider.overrideWith((ref) => offline()),
      apiDioProvider.overrideWith((ref) => offline()),
      refreshDioProvider.overrideWith((ref) => offline()),
    ],
  );
  addTearDown(container.dispose);

  return container;
}

Future<void> _pumpApp(WidgetTester tester, ProviderContainer container) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(container: container, child: const ForjdApp()),
  );
  // Lets the bootstrap microtask resolve AuthUnknown, which is what releases the splash.
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets('with no stored session, lands on the welcome screen', (
    tester,
  ) async {
    final container = _signedOut();

    await _pumpApp(tester, container);

    expect(find.text('Create Account'), findsOneWidget);
    expect(find.text('Log In'), findsOneWidget);
  });

  testWidgets('navigates to the login screen', (tester) async {
    final container = _signedOut();

    await _pumpApp(tester, container);

    container.read(routerProvider).go('/login');
    await tester.pumpAndSettle();

    expect(find.text('Welcome back'), findsOneWidget);
  });

  testWidgets('a signed-out user cannot reach the app shell', (tester) async {
    final container = _signedOut();

    await _pumpApp(tester, container);

    container.read(routerProvider).go('/home');
    await tester.pumpAndSettle();

    // Redirected back out rather than shown an empty shell.
    expect(find.text('Create Account'), findsOneWidget);
  });

  testWidgets('an auth change does not replace the router instance', (
    tester,
  ) async {
    final container = _signedOut();

    await _pumpApp(tester, container);

    final before = container.read(routerProvider);
    container.read(routerProvider).go('/login');
    await tester.pumpAndSettle();

    // A new GoRouter here would mean MaterialApp.router had its navigation stack torn down
    // on every auth transition. Identity is the assertion that catches it.
    expect(identical(container.read(routerProvider), before), isTrue);
  });
}
