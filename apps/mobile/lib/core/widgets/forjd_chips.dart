import 'package:flutter/material.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';

/// A single-select row of pills.
///
/// Generic over the value so callers pass their own enum and get it back, rather than
/// matching on display strings — which is where a localisation or a typo turns into a
/// silently unselectable option.
class ForjdChips<T> extends StatelessWidget {
  const ForjdChips({
    required this.values,
    required this.selected,
    required this.labelOf,
    required this.onSelected,
    super.key,
  });

  final List<T> values;
  final T? selected;
  final String Function(T value) labelOf;
  final ValueChanged<T> onSelected;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [
      for (final value in values)
        _Chip(
          label: labelOf(value),
          isSelected: value == selected,
          onTap: () => onSelected(value),
        ),
    ],
  );
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    inMutuallyExclusiveGroup: true,
    selected: isSelected,
    button: true,
    child: Material(
      color: isSelected ? AppColors.accent : AppColors.elevated,
      borderRadius: BorderRadius.circular(AppDimens.chipRadius),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppDimens.chipRadius),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppDimens.chipRadius),
            border: Border.all(
              color: isSelected ? AppColors.accent : AppColors.border,
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 10),
            child: Text(
              label,
              style: AppText.custom(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: isSelected ? Colors.white : AppColors.dim,
                height: 1,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
