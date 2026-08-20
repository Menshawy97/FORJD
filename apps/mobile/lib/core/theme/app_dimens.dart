/// Sizing tokens transcribed from the FORJD Mobile design.
abstract final class AppDimens {
  /// Buttons and text fields share one height, which is what makes stacked forms line up.
  static const controlHeight = 52.0;

  static const buttonRadius = 12.0;
  static const fieldRadius = 11.0;
  static const cardRadius = 14.0;
  static const chipRadius = 9.0;

  /// Horizontal gutter. The design drifts between 20 and 22 across screens; one value is
  /// used everywhere so columns align when screens sit next to each other.
  static const screenPaddingX = 22.0;

  static const fieldPaddingX = 15.0;
  static const rowPaddingY = 15.0;

  /// Vertical rhythm between stacked form fields.
  static const fieldGap = 16.0;

  static const iconSize = 22.0;
  static const iconSizeSmall = 18.0;

  /// Tap target for the back chevron. Below Material's 48 because the design draws it that
  /// way; the widget pads its hit box out to 48 rather than shrinking the target.
  static const backButtonSize = 34.0;
  static const minTapTarget = 48.0;

  static const tabBarHeight = 76.0;
  static const tabBarBlur = 12.0;

  static const avatarSize = 52.0;
}
