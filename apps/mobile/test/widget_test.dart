import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:forjd/app/app.dart';
import 'package:forjd/app/router.dart';

void main() {
  testWidgets('boots at the splash route', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: ForjdApp()));
    await tester.pumpAndSettle();

    expect(find.text('Splash'), findsWidgets);
  });

  testWidgets('navigates to a named route', (tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(container: container, child: const ForjdApp()),
    );
    await tester.pumpAndSettle();

    container.read(routerProvider).go('/login');
    await tester.pumpAndSettle();

    expect(find.text('Login'), findsWidgets);
  });
}
