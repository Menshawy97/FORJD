import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_dimens.dart';
import 'app_typography.dart';

/// FORJD is dark-only by design, so there is deliberately no `light` counterpart. A second
/// theme nobody has designed would still get rendered by anything Material builds before
/// the router settles, and an unbranded flash is worse than no light mode at all.
abstract final class AppTheme {
  const AppTheme._();

  static ThemeData get dark => ThemeData(
    useMaterial3: true,
    fontFamily: AppText.fontFamily,
    colorScheme: _scheme,
    scaffoldBackgroundColor: AppColors.bg,
    canvasColor: AppColors.bg,
    textTheme: AppText.theme,
    inputDecorationTheme: _inputDecoration,
    dividerTheme: const DividerThemeData(
      color: AppColors.border,
      thickness: 1,
      space: 1,
    ),
    iconTheme: const IconThemeData(
      color: AppColors.dim,
      size: AppDimens.iconSize,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.bg,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: AppText.hdrTitle,
      iconTheme: IconThemeData(color: AppColors.text),
    ),
    textSelectionTheme: const TextSelectionThemeData(
      cursorColor: AppColors.accent,
      selectionHandleColor: AppColors.accent,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.elevated3,
      contentTextStyle: AppText.body.copyWith(color: AppColors.text),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppDimens.fieldRadius),
      ),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: AppColors.accent,
    ),
  );

  /// Written out rather than seeded. `ColorScheme.fromSeed` re-derives every slot tonally,
  /// so none of the design's actual values would survive the trip.
  static const _scheme = ColorScheme.dark(
    primary: AppColors.accent,
    onPrimary: Colors.white,
    primaryContainer: AppColors.accentDark,
    onPrimaryContainer: AppColors.text,
    secondary: AppColors.green,
    onSecondary: AppColors.bg,
    surface: AppColors.bg,
    onSurface: AppColors.text,
    onSurfaceVariant: AppColors.dim,
    surfaceContainerLowest: AppColors.bg,
    surfaceContainerLow: AppColors.fieldBg,
    surfaceContainer: AppColors.surface,
    surfaceContainerHigh: AppColors.elevated2,
    surfaceContainerHighest: AppColors.elevated3,
    error: AppColors.errorText,
    onError: Colors.white,
    outline: AppColors.border,
    outlineVariant: AppColors.borderFaint,
  );

  /// Field styling lives here so a plain [TextField] is already correct and no call site
  /// has to restate the design.
  static final _inputDecoration = InputDecorationTheme(
    filled: true,
    fillColor: AppColors.fieldBg,
    contentPadding: const EdgeInsets.symmetric(
      horizontal: AppDimens.fieldPaddingX,
    ),
    hintStyle: AppText.input.copyWith(color: AppColors.placeholder),
    errorStyle: AppText.inlineError,
    border: _outline(AppColors.border),
    enabledBorder: _outline(AppColors.border),
    // The design defines no focus state. An invisible focus ring is an accessibility
    // regression on Android, so this 1px accent border is a deliberate addition.
    focusedBorder: _outline(AppColors.accent),
    errorBorder: _outline(AppColors.errorBorder),
    focusedErrorBorder: _outline(AppColors.errorBorder),
    disabledBorder: _outline(AppColors.borderFaint),
  );

  static OutlineInputBorder _outline(Color color) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(AppDimens.fieldRadius),
    borderSide: BorderSide(color: color),
  );
}
