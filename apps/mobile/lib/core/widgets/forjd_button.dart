import 'package:flutter/material.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';

enum ForjdButtonKind {
  /// Filled orange with a soft glow. One per screen — the thing the screen is for.
  primary,

  /// Outlined and quiet. The alternative action beside a primary.
  ghost,

  /// Log out, delete. Reads as a warning without being an error state.
  destructive,
}

/// The design's button, at a fixed 52pt so it lines up with ForjdTextField.
///
/// [isLoading] has no counterpart in the design. Every auth action here is a network call,
/// and a button that looks idle while a request is in flight invites a second tap, so the
/// loading state is a deliberate addition rather than a transcription.
class ForjdButton extends StatelessWidget {
  const ForjdButton({
    required this.label,
    required this.onPressed,
    this.kind = ForjdButtonKind.primary,
    this.isLoading = false,
    super.key,
  });

  final String label;

  /// Null disables the button.
  final VoidCallback? onPressed;
  final ForjdButtonKind kind;
  final bool isLoading;

  bool get _enabled => onPressed != null && !isLoading;

  @override
  Widget build(BuildContext context) {
    final (background, foreground, border) = switch (kind) {
      ForjdButtonKind.primary => (AppColors.accent, Colors.white, null),
      ForjdButtonKind.ghost => (
        Colors.transparent,
        AppColors.dim,
        const BorderSide(color: AppColors.border),
      ),
      ForjdButtonKind.destructive => (
        Colors.transparent,
        AppColors.destructive,
        const BorderSide(color: AppColors.destructive),
      ),
    };

    final textStyle = kind == ForjdButtonKind.primary
        ? AppText.button
        : AppText.weighted(AppText.button, FontWeight.w600);

    return Opacity(
      opacity: _enabled ? 1 : 0.5,
      child: Semantics(
        button: true,
        enabled: _enabled,
        child: Material(
          color: background,
          borderRadius: BorderRadius.circular(AppDimens.buttonRadius),
          child: InkWell(
            onTap: _enabled ? onPressed : null,
            borderRadius: BorderRadius.circular(AppDimens.buttonRadius),
            child: Ink(
              height: AppDimens.controlHeight,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppDimens.buttonRadius),
                border: border == null ? null : Border.fromBorderSide(border),
                boxShadow: kind == ForjdButtonKind.primary && _enabled
                    ? [
                        BoxShadow(
                          color: AppColors.accent.withValues(alpha: 0.22),
                          blurRadius: 22,
                          offset: const Offset(0, 6),
                        ),
                      ]
                    : null,
              ),
              child: Center(
                child: isLoading
                    ? SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation(foreground),
                        ),
                      )
                    : Text(label, style: textStyle.copyWith(color: foreground)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
