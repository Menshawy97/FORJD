import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:forjd/app/router.dart';
import 'package:forjd/core/theme/app_theme.dart';

class ForjdApp extends ConsumerWidget {
  const ForjdApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'FORJD',
      // Both slots and an explicit mode: themeMode alone already forces dark, but a
      // MaterialApp nested for a dialog or a test reads `theme`, and it should get the
      // brand rather than Flutter's default light palette.
      theme: AppTheme.dark,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.dark,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
