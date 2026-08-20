import 'package:flutter/painting.dart';

/// Colour tokens transcribed from the FORJD Mobile design.
///
/// Named for the role each colour plays, never for its value, so a palette change is an
/// edit here rather than a search for a hex string across the app.
abstract final class AppColors {
  /// Page background.
  static const bg = Color(0xFF08090A);

  /// Default card and panel fill.
  static const surface = Color(0xFF17181A);

  /// Text input fill. Slightly darker than [surface] so fields read as recessed.
  static const fieldBg = Color(0xFF151517);

  static const elevated = Color(0xFF191A1C);
  static const elevated2 = Color(0xFF1C1D20);
  static const elevated3 = Color(0xFF232326);

  /// rgba(255, 255, 255, .07) — hairline borders on cards, fields and the tab bar.
  static const border = Color(0x12FFFFFF);

  /// rgba(255, 255, 255, .05) — the fainter divider between list rows.
  static const borderFaint = Color(0x0DFFFFFF);

  static const accent = Color(0xFFE9712F);
  static const accentDark = Color(0xFFA84D1D);
  static const accentHover = Color(0xFFF4894C);

  /// Positive/recovery readings.
  static const green = Color(0xFF79B98A);

  static const text = Color(0xFFF6F5F3);
  static const dim = Color(0xFF9A9A92);
  static const dimmer = Color(0xFF6E6E66);

  /// Uppercase section and field labels.
  static const label = Color(0xFF77776F);

  static const placeholder = Color(0xFF5D5D57);

  /// Terms-and-conditions footnotes.
  static const legal = Color(0xFF5C5C55);

  static const errorBorder = Color(0xFFB8422F);
  static const errorText = Color(0xFFE05A3C);

  /// Log out, delete — destructive but not an error.
  static const destructive = Color(0xFFC9503C);

  static const tabInactive = Color(0xFF6B6B64);

  /// rgba(14, 14, 15, .96) — sits behind the tab bar's blur.
  static const tabBarBg = Color(0xF50E0E0F);

  /// The warm tint on the welcome screen's feature list.
  static const welcomeFeature = Color(0xFFD8B79C);
}
