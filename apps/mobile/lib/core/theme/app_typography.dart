import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Type tokens transcribed from the FORJD Mobile design.
///
/// The design expresses letter-spacing in CSS `em`; Flutter's [TextStyle.letterSpacing] is
/// in logical pixels. Every converted value below carries its arithmetic in a comment,
/// because a silently mis-converted `em` is the most likely way for this file to look
/// correct and render wrong.
abstract final class AppText {
  /// Bundled at assets/fonts/Archivo-Variable.ttf (SIL OFL 1.1).
  ///
  /// Upstream publishes only a variable face, so every style sets both [TextStyle.fontWeight]
  /// and a `wght` [FontVariation]: the axis is what actually moves the rendered weight, while
  /// `fontWeight` still governs the fallback face. Setting one without the other is the
  /// failure mode to watch for — use [weighted] rather than a bare `copyWith`.
  static const fontFamily = 'Archivo';

  static const _base = TextStyle(fontFamily: fontFamily, color: AppColors.text);

  /// Welcome screen headline. -.03em x 34 = -1.02
  static const h1Welcome = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.text,
    fontSize: 34,
    fontWeight: FontWeight.w700,
    fontVariations: [FontVariation('wght', 700)],
    height: 1.14,
    letterSpacing: -1.02,
  );

  /// Log in / Create account headline. -.02em x 27 = -0.54
  static const h1Auth = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.text,
    fontSize: 27,
    fontWeight: FontWeight.w700,
    fontVariations: [FontVariation('wght', 700)],
    height: 1.15,
    letterSpacing: -0.54,
  );

  /// Screen header with a back button. -.02em x 26 = -0.52
  static const hdrTitle = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.text,
    fontSize: 26,
    fontWeight: FontWeight.w700,
    fontVariations: [FontVariation('wght', 700)],
    height: 1.15,
    letterSpacing: -0.52,
  );

  /// Profile name. -.01em x 19 = -0.19
  static const nameTitle = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.text,
    fontSize: 19,
    fontWeight: FontWeight.w700,
    fontVariations: [FontVariation('wght', 700)],
    letterSpacing: -0.19,
  );

  /// Sub-headline under an h1.
  static const body = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.dim,
    fontSize: 13.5,
    fontWeight: FontWeight.w400,
    fontVariations: [FontVariation('wght', 400)],
    height: 1.4,
  );

  /// Uppercase field and section label. .14em x 9.5 = 1.33
  /// The widget uppercases the text; callers pass normal casing.
  static const label = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.label,
    fontSize: 9.5,
    fontWeight: FontWeight.w600,
    fontVariations: [FontVariation('wght', 600)],
    height: 1,
    letterSpacing: 1.33,
  );

  static const input = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.text,
    fontSize: 14.5,
    fontWeight: FontWeight.w500,
    fontVariations: [FontVariation('wght', 500)],
  );

  /// .01em x 15.5 = 0.155
  static const button = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.text,
    fontSize: 15.5,
    fontWeight: FontWeight.w700,
    fontVariations: [FontVariation('wght', 700)],
    height: 1,
    letterSpacing: 0.155,
  );

  /// "Forgot password?", "Create one".
  static const link = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.accent,
    fontSize: 12.5,
    fontWeight: FontWeight.w600,
    fontVariations: [FontVariation('wght', 600)],
    height: 1,
  );

  static const legal = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.legal,
    fontSize: 11.5,
    fontWeight: FontWeight.w400,
    fontVariations: [FontVariation('wght', 400)],
    height: 1.5,
  );

  /// The dimmed line under the profile name.
  static const handle = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.dimmer,
    fontSize: 12,
    fontWeight: FontWeight.w400,
    fontVariations: [FontVariation('wght', 400)],
    height: 1,
  );

  static const rowTitle = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.text,
    fontSize: 14.5,
    fontWeight: FontWeight.w600,
    fontVariations: [FontVariation('wght', 600)],
    height: 1.25,
  );

  static const rowSubtitle = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.dimmer,
    fontSize: 12,
    fontWeight: FontWeight.w400,
    fontVariations: [FontVariation('wght', 400)],
    height: 1.3,
  );

  /// The tab bar swaps this to w600 when a tab is selected — via [weighted], so the
  /// variable axis moves with it.
  static const tabLabel = TextStyle(
    fontFamily: fontFamily,
    fontSize: 10,
    fontWeight: FontWeight.w500,
    fontVariations: [FontVariation('wght', 500)],
    height: 1,
  );

  static const inlineError = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.errorText,
    fontSize: 12,
    fontWeight: FontWeight.w500,
    fontVariations: [FontVariation('wght', 500)],
    height: 1,
  );

  /// The destructive action at the foot of a settings list.
  static const destructiveAction = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.destructive,
    fontSize: 13,
    fontWeight: FontWeight.w600,
    fontVariations: [FontVariation('wght', 600)],
    height: 1,
  );

  /// The welcome screen's three feature rows.
  static const welcomeFeature = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.welcomeFeature,
    fontSize: 12.8,
    fontWeight: FontWeight.w500,
    fontVariations: [FontVariation('wght', 500)],
    height: 1.3,
  );

  /// The wordmark. .02em x 23 = 0.46
  static const wordmark = TextStyle(
    fontFamily: fontFamily,
    color: AppColors.text,
    fontSize: 23,
    fontWeight: FontWeight.w800,
    fontVariations: [FontVariation('wght', 800)],
    height: 1,
    letterSpacing: 0.46,
  );

  /// Material builds dialogs, snackbars and menus from this even where FORJD's own widgets
  /// do not, so it must carry the brand rather than Flutter's defaults.
  static TextTheme get theme => const TextTheme(
    headlineLarge: h1Welcome,
    headlineMedium: h1Auth,
    headlineSmall: hdrTitle,
    titleLarge: nameTitle,
    titleMedium: rowTitle,
    bodyLarge: input,
    bodyMedium: body,
    bodySmall: rowSubtitle,
    labelLarge: button,
    labelMedium: tabLabel,
    labelSmall: label,
  );

  /// Restyles [base] to [weight], moving the variable `wght` axis alongside
  /// [TextStyle.fontWeight]. A bare `copyWith(fontWeight: ...)` would change the fallback
  /// face and leave Archivo rendering at its previous weight.
  static TextStyle weighted(TextStyle base, FontWeight weight) => base.copyWith(
    fontWeight: weight,
    fontVariations: [FontVariation('wght', weight.value.toDouble())],
  );

  /// Escape hatch for one-off styles that still need the family and default colour.
  static TextStyle custom({
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? height,
    double? letterSpacing,
  }) {
    final style = _base.copyWith(
      fontSize: fontSize,
      color: color,
      height: height,
      letterSpacing: letterSpacing,
    );

    return fontWeight == null ? style : weighted(style, fontWeight);
  }
}
