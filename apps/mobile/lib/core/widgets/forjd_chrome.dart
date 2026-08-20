import 'package:flutter/material.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';
import 'package:forjd/core/widgets/forjd_icon.dart';

/// The design's back chevron.
///
/// Drawn at the design's size but padded out to a 48pt hit box: the visual size is a design
/// decision, the tap target is an accessibility floor, and they need not be the same number.
class ForjdBackButton extends StatelessWidget {
  const ForjdBackButton({required this.onPressed, super.key});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Back',
    child: InkResponse(
      onTap: onPressed,
      radius: AppDimens.backButtonSize,
      child: const SizedBox(
        width: AppDimens.minTapTarget,
        height: AppDimens.minTapTarget,
        child: Center(
          child: ForjdIcon('chevronLeft', color: AppColors.text, size: 20),
        ),
      ),
    ),
  );
}

/// A screen title with an optional back button above it.
class ForjdHeader extends StatelessWidget {
  const ForjdHeader({required this.title, this.onBack, this.trailing, super.key});

  final String title;
  final VoidCallback? onBack;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(
      AppDimens.screenPaddingX,
      2,
      AppDimens.screenPaddingX,
      14,
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (onBack != null)
          Align(
            alignment: Alignment.centerLeft,
            // Pulled left so the glyph, not the padded hit box, lines up with the gutter.
            child: Transform.translate(
              offset: const Offset(-14, 0),
              child: ForjdBackButton(onPressed: onBack!),
            ),
          ),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(child: Text(title, style: AppText.hdrTitle)),
            ?trailing,
          ],
        ),
      ],
    ),
  );
}

/// The four-bar mark beside the wordmark. The third bar is the darker orange, which is
/// what stops it reading as a plain ascending bar chart.
class ForjdLogoMark extends StatelessWidget {
  const ForjdLogoMark({this.scale = 1, super.key});

  final double scale;

  static const _barHeights = [11.0, 26.0, 9.0, 20.0];
  static const _accentedBar = 2;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: 26 * scale,
    child: Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (var i = 0; i < _barHeights.length; i++) ...[
          if (i > 0) SizedBox(width: 3 * scale),
          Container(
            width: 5.5 * scale,
            height: _barHeights[i] * scale,
            decoration: BoxDecoration(
              color: i == _accentedBar ? AppColors.accentDark : AppColors.accent,
              borderRadius: BorderRadius.circular(1.5 * scale),
            ),
          ),
        ],
      ],
    ),
  );
}

/// Mark plus wordmark, as it appears on the welcome and home screens.
class ForjdWordmark extends StatelessWidget {
  const ForjdWordmark({this.scale = 1, super.key});

  final double scale;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'FORJD',
    excludeSemantics: true,
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        ForjdLogoMark(scale: scale),
        SizedBox(width: 11 * scale),
        Text('FORJD', style: AppText.wordmark.copyWith(fontSize: 23 * scale)),
      ],
    ),
  );
}
