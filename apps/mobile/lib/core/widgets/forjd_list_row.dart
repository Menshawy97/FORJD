import 'package:flutter/material.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';
import 'package:forjd/core/widgets/forjd_icon.dart';

/// A settings-style row: optional leading icon, title, optional subtitle, trailing
/// affordance, and a hairline beneath.
class ForjdRow extends StatelessWidget {
  const ForjdRow({
    required this.title,
    this.icon,
    this.subtitle,
    this.onTap,
    this.trailing,
    this.showDivider = true,
    super.key,
  });

  final String title;

  /// A name from the FORJD icon set.
  final String? icon;
  final String? subtitle;
  final VoidCallback? onTap;

  /// Replaces the default chevron. Pass a shrunk box for no affordance at all.
  final Widget? trailing;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final subtitle = this.subtitle;

    final content = Container(
      padding: const EdgeInsets.symmetric(vertical: AppDimens.rowPaddingY),
      decoration: showDivider
          ? const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.borderFaint)),
            )
          : null,
      child: Row(
        children: [
          if (icon != null) ...[
            ForjdIcon(icon!, color: AppColors.dim),
            const SizedBox(width: 14),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: AppText.rowTitle),
                if (subtitle != null) ...[
                  const SizedBox(height: 3),
                  Text(subtitle, style: AppText.rowSubtitle),
                ],
              ],
            ),
          ),
          if (trailing != null)
            trailing!
          else if (onTap != null)
            const Opacity(
              opacity: 0.5,
              child: ForjdIcon('chevron', size: AppDimens.iconSizeSmall),
            ),
        ],
      ),
    );

    if (onTap == null) {
      return content;
    }

    return InkWell(
      onTap: onTap,
      // The row is one tappable unit, so it is announced as one button rather than as a
      // title and a subtitle a screen reader has to stitch together.
      child: Semantics(
        button: true,
        label: subtitle == null ? title : '$title. $subtitle',
        excludeSemantics: true,
        child: content,
      ),
    );
  }
}
