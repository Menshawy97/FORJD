import 'dart:ui';

import 'package:flutter/material.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';
import 'package:forjd/core/widgets/forjd_icon.dart';

/// One destination in the tab bar.
class ForjdTab {
  const ForjdTab({required this.icon, required this.label});

  /// A name from the FORJD icon set.
  final String icon;
  final String label;
}

/// The design's five-destination tab bar: a translucent, blurred strip over the content.
///
/// It reports taps by index and knows nothing about routes. Navigation belongs to whatever
/// owns the shell, which keeps this widget testable without a router.
class ForjdTabBar extends StatelessWidget {
  const ForjdTabBar({
    required this.currentIndex,
    required this.onTap,
    this.tabs = defaultTabs,
    super.key,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;
  final List<ForjdTab> tabs;

  static const defaultTabs = [
    ForjdTab(icon: 'home', label: 'Home'),
    ForjdTab(icon: 'train', label: 'Train'),
    ForjdTab(icon: 'progress', label: 'Progress'),
    ForjdTab(icon: 'rank', label: 'Rank'),
    ForjdTab(icon: 'profile', label: 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    // Clipped to the bar so the blur frosts the content scrolling beneath it rather than
    // the whole screen.
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: AppDimens.tabBarBlur,
          sigmaY: AppDimens.tabBarBlur,
        ),
        child: Container(
          padding: const EdgeInsets.fromLTRB(6, 10, 6, 0),
          decoration: const BoxDecoration(
            color: AppColors.tabBarBg,
            border: Border(top: BorderSide(color: AppColors.border)),
          ),
          child: SafeArea(
            top: false,
            child: SizedBox(
              height: AppDimens.tabBarHeight - 10,
              child: Row(
                children: [
                  for (var i = 0; i < tabs.length; i++)
                    Expanded(
                      child: _TabItem(
                        tab: tabs[i],
                        isSelected: i == currentIndex,
                        onTap: () => onTap(i),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TabItem extends StatelessWidget {
  const _TabItem({
    required this.tab,
    required this.isSelected,
    required this.onTap,
  });

  final ForjdTab tab;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = isSelected ? AppColors.accent : AppColors.tabInactive;

    return Semantics(
      button: true,
      selected: isSelected,
      label: tab.label,
      excludeSemantics: true,
      child: InkResponse(
        onTap: onTap,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ForjdIcon(tab.icon, color: color),
            const SizedBox(height: 5),
            Text(
              tab.label,
              style: AppText.weighted(
                AppText.tabLabel,
                isSelected ? FontWeight.w600 : FontWeight.w500,
              ).copyWith(color: color),
            ),
          ],
        ),
      ),
    );
  }
}
