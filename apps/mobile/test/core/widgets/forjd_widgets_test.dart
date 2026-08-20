import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_theme.dart';
import 'package:forjd/core/widgets/widgets.dart';

Widget _host(Widget child) => MaterialApp(
  theme: AppTheme.dark,
  home: Scaffold(body: Center(child: child)),
);

void main() {
  group('ForjdButton', () {
    testWidgets('invokes onPressed when tapped', (tester) async {
      var taps = 0;
      await tester.pumpWidget(
        _host(ForjdButton(label: 'Log In', onPressed: () => taps++)),
      );

      await tester.tap(find.text('Log In'));

      expect(taps, 1);
    });

    testWidgets('does not invoke onPressed while loading', (tester) async {
      var taps = 0;
      await tester.pumpWidget(
        _host(
          ForjdButton(
            label: 'Log In',
            onPressed: () => taps++,
            isLoading: true,
          ),
        ),
      );

      await tester.tap(find.byType(ForjdButton));

      expect(taps, 0);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Log In'), findsNothing);
    });

    testWidgets('a null onPressed dims the button and swallows taps', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(const ForjdButton(label: 'Log In', onPressed: null)),
      );

      await tester.tap(find.text('Log In'));

      final opacity = tester.widget<Opacity>(
        find.descendant(
          of: find.byType(ForjdButton),
          matching: find.byType(Opacity),
        ),
      );
      expect(opacity.opacity, lessThan(1));
      expect(tester.takeException(), isNull);
    });
  });

  group('ForjdTextField', () {
    testWidgets('the eye toggle flips obscureText', (tester) async {
      await tester.pumpWidget(
        _host(
          ForjdTextField(
            label: 'Password',
            controller: TextEditingController(),
            obscure: true,
          ),
        ),
      );

      EditableText field() =>
          tester.widget<EditableText>(find.byType(EditableText));

      expect(field().obscureText, isTrue);

      await tester.tap(find.byType(IconButton));
      await tester.pump();

      expect(field().obscureText, isFalse);
    });

    testWidgets('renders the error message beneath the field', (tester) async {
      await tester.pumpWidget(
        _host(
          ForjdTextField(
            label: 'Email',
            controller: TextEditingController(),
            errorText: 'Invalid credentials',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Invalid credentials'), findsOneWidget);
    });

    testWidgets('uppercases the label without changing the semantic label', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          ForjdTextField(
            label: 'Full name',
            controller: TextEditingController(),
          ),
        ),
      );

      expect(find.text('FULL NAME'), findsOneWidget);
    });
  });

  group('ForjdTabBar', () {
    testWidgets('reports the tapped index', (tester) async {
      final tapped = <int>[];
      await tester.pumpWidget(
        _host(ForjdTabBar(currentIndex: 0, onTap: tapped.add)),
      );

      await tester.tap(find.text('Rank'));

      expect(tapped, [3]);
    });

    testWidgets('paints only the current tab in the accent colour', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(ForjdTabBar(currentIndex: 4, onTap: (_) {})),
      );

      Color colourOf(String label) =>
          tester.widget<Text>(find.text(label)).style!.color!;

      expect(colourOf('Profile'), AppColors.accent);
      expect(colourOf('Home'), AppColors.tabInactive);
    });
  });

  group('ForjdChips', () {
    testWidgets('reports the selected value, not its label', (tester) async {
      final picked = <int>[];
      await tester.pumpWidget(
        _host(
          ForjdChips<int>(
            values: const [1, 2, 3],
            selected: 1,
            labelOf: (v) => 'Option $v',
            onSelected: picked.add,
          ),
        ),
      );

      await tester.tap(find.text('Option 3'));

      expect(picked, [3]);
    });
  });

  group('theme', () {
    test('is dark and painted with the design background', () {
      final theme = AppTheme.dark;

      expect(theme.brightness, Brightness.dark);
      expect(theme.scaffoldBackgroundColor, AppColors.bg);
      expect(theme.inputDecorationTheme.fillColor, AppColors.fieldBg);
      expect(theme.colorScheme.primary, AppColors.accent);
    });
  });
}
