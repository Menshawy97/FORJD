import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';
import 'package:forjd/core/widgets/widgets.dart';
import 'package:forjd/features/auth/application/auth_controller.dart';
import 'package:forjd/features/auth/domain/auth_models.dart';
import 'package:forjd/features/auth/domain/auth_state.dart';
import 'package:forjd/features/profile/application/profile_controller.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final profile = ref.watch(profileControllerProvider);
    final signedInEmail = auth is AuthAuthenticated ? auth.email : null;

    // While the request is in flight, fall back to the last name seen on this device. A
    // name that was true a minute ago beats a spinner where a name should be.
    final cachedName = auth is AuthAuthenticated
        ? ref.watch(cachedDisplayNameProvider(auth.userId)).valueOrNull
        : null;

    final name =
        profile.valueOrNull?.profile?.displayName ??
        cachedName ??
        signedInEmail ??
        'Your profile';

    final units = profile.valueOrNull?.profile?.unitSystem;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: AppColors.accent,
          backgroundColor: AppColors.surface,
          onRefresh: () =>
              ref.read(profileControllerProvider.notifier).refresh(),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              AppDimens.screenPaddingX,
              4,
              AppDimens.screenPaddingX,
              // Clears the translucent tab bar the body extends behind.
              AppDimens.tabBarHeight + 26,
            ),
            children: [
              _Header(name: name, email: signedInEmail),
              if (profile.hasError)
                const ForjdInlineError(
                  "Couldn't refresh your profile. Pull down to try again.",
                ),
              const ForjdSectionLabel('Training'),
              ForjdRow(
                icon: 'target',
                title: 'Goals & Activities',
                subtitle: 'Not set up yet',
                onTap: () => _notYet(context, 'Goals & activities'),
              ),
              ForjdRow(
                icon: 'chart',
                title: 'Units & Preferences',
                subtitle: units == UnitSystem.imperial
                    ? 'Imperial · lb'
                    : 'Metric · kg',
                onTap: () => _notYet(context, 'Units & preferences'),
              ),
              const ForjdSectionLabel('Data'),
              ForjdRow(
                icon: 'link',
                title: 'Connected Sources',
                subtitle: 'None connected',
                onTap: () => _notYet(context, 'Connected sources'),
              ),
              ForjdRow(
                icon: 'scale',
                title: 'InBody History',
                subtitle: 'No scans yet',
                onTap: () => _notYet(context, 'InBody history'),
              ),
              const ForjdSectionLabel('Privacy & permissions'),
              ForjdRow(
                icon: 'shield',
                title: 'Privacy Settings',
                subtitle: 'Leaderboard, location, AI',
                onTap: () => _notYet(context, 'Privacy settings'),
              ),
              ForjdRow(
                icon: 'bell',
                title: 'Notifications',
                subtitle: 'Workouts, recovery, PRs',
                onTap: () => _notYet(context, 'Notifications'),
              ),
              const SizedBox(height: 26),
              GestureDetector(
                onTap: () => ref.read(authControllerProvider.notifier).logout(),
                behavior: HitTestBehavior.opaque,
                child: const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text('Log out', style: AppText.destructiveAction),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// These rows are in the design but belong to later phases. Saying so is more honest than
  /// a row that silently does nothing.
  void _notYet(BuildContext context, String what) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text('$what arrives in a later phase.')),
      );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.name, required this.email});

  final String name;
  final String? email;

  /// Up to two initials, or a fallback glyph. Stands in for the avatar until Phase 5 gives
  /// uploads somewhere to go — an upload button that does nothing would be worse than none.
  String get _initials {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .toList();

    if (parts.isEmpty) {
      return '?';
    }

    return parts.take(2).map((part) => part[0].toUpperCase()).join();
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 20),
    child: Row(
      children: [
        Container(
          width: AppDimens.avatarSize,
          height: AppDimens.avatarSize,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.elevated2,
            borderRadius: BorderRadius.circular(AppDimens.cardRadius),
          ),
          child: Text(_initials, style: AppText.nameTitle),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                name,
                style: AppText.nameTitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (email != null) ...[
                const SizedBox(height: 6),
                // The design shows an @handle here. There is no username field in the API
                // and no uniqueness policy behind one, so the address the account is keyed
                // on stands in rather than inventing a second identity.
                Text(
                  email!,
                  style: AppText.handle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ],
          ),
        ),
        IconButton(
          onPressed: () => context.go('/profile/edit'),
          tooltip: 'Edit profile',
          icon: const Icon(Icons.edit_outlined, size: 19, color: AppColors.dim),
        ),
      ],
    ),
  );
}
