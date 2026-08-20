import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';
import 'package:forjd/core/widgets/widgets.dart';

/// The signed-in frame: the current tab's content with the tab bar over it.
///
/// Owns navigation so [ForjdTabBar] does not have to — the bar reports an index, and the
/// translation from index to branch happens here.
class AppShell extends StatelessWidget {
  const AppShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) => Scaffold(
    // The tab bar is translucent and blurs what passes under it, so the body must extend
    // behind it rather than stop above it.
    extendBody: true,
    body: navigationShell,
    bottomNavigationBar: ForjdTabBar(
      currentIndex: navigationShell.currentIndex,
      onTap: (index) => navigationShell.goBranch(
        index,
        // Tapping the tab you are already on pops that branch back to its root, which is
        // the behaviour a five-tab bar is expected to have.
        initialLocation: index == navigationShell.currentIndex,
      ),
    ),
  );
}

/// Shown while the app works out whether there is a stored session.
///
/// Deliberately almost empty: it exists only for the frames between launch and the keystore
/// answering, and anything more would flash.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: ForjdWordmark()));
}

/// Stands in for a tab whose content belongs to a later phase.
///
/// An honest stub with the real chrome, rather than an empty screen that reads as broken.
class PlaceholderTab extends StatelessWidget {
  const PlaceholderTab({required this.title, super.key});

  final String title;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppDimens.screenPaddingX,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(title, style: AppText.h1Auth),
            const SizedBox(height: 9),
            const Text('Coming in a later phase.', style: AppText.body),
          ],
        ),
      ),
    ),
  );
}
